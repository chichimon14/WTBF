import JSZip from 'jszip';

/**
 * 辅助函数：判断一个 <w:r> 节点是否包含高亮属性
 */
function hasHighlight(rNode) {
  const rPr = rNode.querySelector('rPr');
  if (!rPr) return false;
  const highlight = rPr.querySelector('highlight');
  return highlight !== null;
}

/**
 * 辅助函数：获取一个 <w:r> 节点中 <w:t> 的文本
 */
function getRunText(rNode) {
  const tNode = rNode.querySelector('t');
  return tNode ? tNode.textContent : '';
}

/**
 * 辅助函数：删除 <w:r> 节点中的高亮属性
 */
function removeHighlight(rNode) {
  const rPr = rNode.querySelector('rPr');
  if (!rPr) return;
  const highlight = rPr.querySelector('highlight');
  if (highlight) {
    highlight.parentNode.removeChild(highlight);
  }
}

/**
 * 清洗提示词：剥离首尾的星号、括号、空格等修饰符
 */
export function cleanPromptText(text) {
  return text.replace(/^[\*【\[\s\u00A0\u3000]+|[\*】\]\s\u00A0\u3000]+$/g, '').trim();
}

/**
 * 辅助函数：根据占位符在段落文本中的位置获取上下文
 */
function getContextTextForStar(pText, starMatch, matchIndex) {
  const leftText = pText.substring(0, matchIndex);
  const cleanLeft = leftText.trim().slice(-6);
  return cleanLeft.replace(/[\s\r\n]+/g, '');
}

/**
 * 从主 xmlDoc 提取高亮和星号标记，直接共享同一 DOM 树，确保替换引用生效
 * @param {Document} xmlDoc 共享的主 DOM 树
 * @returns {Object}
 */
function extractMarkersFromXml(xmlDoc) {
  const paragraphs = xmlDoc.getElementsByTagName('w:p');
  const finalGroups = [];
  
  const uniqueHighlights = new Set();
  const uniqueStars = new Set();

  for (let pIndex = 0; pIndex < paragraphs.length; pIndex++) {
    const pNode = paragraphs[pIndex];
    const childNodes = Array.from(pNode.childNodes);
    
    // --- 1. 高亮提取 ---
    let currentHighlightGroup = null;
    const tempHighlightGroups = [];
    
    for (let i = 0; i < childNodes.length; i++) {
      const child = childNodes[i];
      if (child.nodeName === 'w:r') {
        const isHighlighted = hasHighlight(child);
        const text = getRunText(child);
        if (text !== '') {
          if (isHighlighted) {
            if (!currentHighlightGroup) {
              currentHighlightGroup = {
                type: 'highlight',
                text: text,
                nodes: [child]
              };
            } else {
              currentHighlightGroup.text += text;
              currentHighlightGroup.nodes.push(child);
            }
          } else {
            if (currentHighlightGroup) {
              tempHighlightGroups.push(currentHighlightGroup);
              currentHighlightGroup = null;
            }
          }
        }
      } else if (child.nodeName !== 'w:pPr') {
        if (currentHighlightGroup) {
          tempHighlightGroups.push(currentHighlightGroup);
          currentHighlightGroup = null;
        }
      }
    }
    if (currentHighlightGroup) {
      tempHighlightGroups.push(currentHighlightGroup);
    }

    for (const group of tempHighlightGroups) {
      group.cleanedPrompt = cleanPromptText(group.text);
      uniqueHighlights.add(group.cleanedPrompt);
      finalGroups.push(group);
    }

    // --- 2. 星号提取 ---
    let pText = '';
    const runNodes = [];
    const highlightedRanges = [];
    
    for (const child of childNodes) {
      if (child.nodeName === 'w:r') {
        const text = getRunText(child);
        const start = pText.length;
        pText += text;
        const end = pText.length;
        runNodes.push(child);
        
        if (hasHighlight(child) && text !== '') {
          highlightedRanges.push({ start, end });
        }
      }
    }

    if (pText === '') continue;

    const isOverlappingHighlight = (matchStart, matchEnd) => {
      return highlightedRanges.some(r => {
        return matchStart < r.end && matchEnd > r.start;
      });
    };

    const promptStarRegex = /\*{1,3}([^*，。、；：！？“”‘’()（）\s\r\n]{1,15})\*{1,3}/g;
    const pureStarRegex = /\*{3,}/g;

    let match;
    const detectedStars = [];

    while ((match = promptStarRegex.exec(pText)) !== null) {
      const matchText = match[0];
      const matchIndex = match.index;
      const matchEnd = matchIndex + matchText.length;
      
      if (isOverlappingHighlight(matchIndex, matchEnd)) {
        continue;
      }
      
      const cleaned = cleanPromptText(matchText);
      
      detectedStars.push({
        type: 'star_prompt',
        text: matchText,
        cleanedPrompt: cleaned,
        index: matchIndex,
        length: matchText.length
      });
    }

    while ((match = pureStarRegex.exec(pText)) !== null) {
      const matchText = match[0];
      const matchIndex = match.index;
      const matchEnd = matchIndex + matchText.length;
      
      if (isOverlappingHighlight(matchIndex, matchEnd)) {
        continue;
      }
      
      const isOverlapped = detectedStars.some(ds => 
        matchIndex >= ds.index && (matchIndex + matchText.length) <= (ds.index + ds.length)
      );

      if (!isOverlapped) {
        const prev = getContextTextForStar(pText, matchText, matchIndex);
        const contextStr = prev ? `${prev}、` : '';
        
        detectedStars.push({
          type: 'star_pure',
          text: matchText,
          cleanedPrompt: `星号填空 (前文: ...${contextStr || '无'})`,
          index: matchIndex,
          length: matchText.length
        });
      }
    }

    detectedStars.forEach(ds => {
      uniqueStars.add(ds.cleanedPrompt);
      finalGroups.push({
        type: 'star',
        text: ds.text,
        cleanedPrompt: ds.cleanedPrompt,
        runNodes: runNodes
      });
    });
  }
  
  return {
    uniqueHighlights: Array.from(uniqueHighlights),
    uniqueStars: Array.from(uniqueStars),
    groups: finalGroups
  };
}

/**
 * 核心解析函数
 */
export async function parseDocxHighlights(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    const xmlFiles = Object.keys(zip.files).filter(name => 
      name === 'word/document.xml' || 
      name.startsWith('word/header') || 
      name.startsWith('word/footer')
    );
    
    let allHighlights = new Set();
    let allStars = new Set();
    const parser = new DOMParser();
    
    for (const xmlPath of xmlFiles) {
      const xmlText = await zip.file(xmlPath).async('text');
      const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
      // 直接把解析完的主 xmlDoc 传给提取函数，杜绝反复解析与引用隔离
      const { uniqueHighlights, uniqueStars } = extractMarkersFromXml(xmlDoc);
      uniqueHighlights.forEach(w => allHighlights.add(w));
      uniqueStars.forEach(w => allStars.add(w));
    }
    
    return {
      fileName: file.name,
      zipInstance: zip,
      xmlFiles: xmlFiles,
      highlights: Array.from(allHighlights),
      stars: Array.from(allStars),
      underlines: []
    };
  } catch (error) {
    console.error('解析 DOCX 失败:', error);
    throw new Error(`文件 "${file.name}" 解析失败，请确认是否为合法的 Word (.docx) 文档。`);
  }
}

/**
 * 核心替换函数
 */
export async function replaceDocxHighlights(zipInstance, xmlFiles, mapping) {
  const newZip = new JSZip();
  for (const [path, fileObj] of Object.entries(zipInstance.files)) {
    if (fileObj.dir) {
      newZip.folder(path);
    } else {
      const content = await fileObj.async('uint8array');
      newZip.file(path, content);
    }
  }

  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  for (const xmlPath of xmlFiles) {
    const xmlText = await newZip.file(xmlPath).async('text');
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    
    // 关键修正：直接把当前待修改的主 xmlDoc 实例传入提取器！
    // 这样提取出的所有节点都是 xmlDoc 里的真实实体节点，所有的 DOM 操作都会直接写进内存中！
    const currentDocExtract = extractMarkersFromXml(xmlDoc);
    
    // 1. 进行高亮类型替换
    const highlightGroups = currentDocExtract.groups.filter(g => g.type === 'highlight');
    highlightGroups.forEach(group => {
      const promptKey = group.cleanedPrompt;
      if (mapping.hasOwnProperty(promptKey)) {
        const rawValue = mapping[promptKey];
        let finalValue = rawValue;
        
        const originalLength = group.text.length;
        if (rawValue.length < originalLength) {
          finalValue = rawValue + ' '.repeat(originalLength - rawValue.length);
        }
        
        const firstNode = group.nodes[0];
        const tNode = firstNode.querySelector('t');
        if (tNode) {
          tNode.textContent = finalValue;
        }
        removeHighlight(firstNode);
        
        for (let n = 1; n < group.nodes.length; n++) {
          const otherNode = group.nodes[n];
          const otherT = otherNode.querySelector('t');
          if (otherT) otherT.textContent = '';
          removeHighlight(otherNode);
        }
      }
    });

    // 2. 进行星号类型替换
    const starGroups = currentDocExtract.groups.filter(g => g.type === 'star');
    const paragraphs = xmlDoc.getElementsByTagName('w:p');
    
    for (let pIndex = 0; pIndex < paragraphs.length; pIndex++) {
      const pNode = paragraphs[pIndex];
      const runNodes = Array.from(pNode.childNodes).filter(child => child.nodeName === 'w:r');
      if (runNodes.length === 0) continue;

      const tNodes = [];
      const origLens = [];
      let pText = '';
      
      runNodes.forEach(rNode => {
        const tNode = rNode.querySelector('t');
        if (tNode) {
          const txt = tNode.textContent;
          tNodes.push(tNode);
          origLens.push(txt.length);
          pText += txt;
        }
      });
      
      if (pText === '' || tNodes.length === 0) continue;
      
      // 因为现在 starGroups 里的 nodes 和 runNodes 都是 100% 同源属于当前 xmlDoc 的，所以此 parentNode 判断完全吻合！
      const pStars = starGroups.filter(g => g.runNodes[0] && g.runNodes[0].parentNode === pNode);
      if (pStars.length === 0) continue;
      
      let modifiedText = pText;
      let hasReplacements = false;
      
      pStars.forEach(group => {
        const promptKey = group.cleanedPrompt;
        if (mapping.hasOwnProperty(promptKey)) {
          const rawValue = mapping[promptKey];
          let finalValue = rawValue;
          
          const originalLength = group.text.length;
          if (rawValue.length < originalLength) {
            finalValue = rawValue + '*'.repeat(originalLength - rawValue.length);
          }
          
          if (modifiedText.includes(group.text)) {
            modifiedText = modifiedText.replace(group.text, finalValue);
            hasReplacements = true;
          }
        }
      });
      
      if (hasReplacements) {
        let cursor = 0;
        for (let idx = 0; idx < tNodes.length; idx++) {
          const tNode = tNodes[idx];
          const origLen = origLens[idx];
          
          if (idx === tNodes.length - 1) {
            tNode.textContent = modifiedText.substring(cursor);
          } else {
            tNode.textContent = modifiedText.substring(cursor, cursor + origLen);
            cursor += origLen;
          }
        }
      }
    }
    
    // 写回 zip
    const newXmlText = serializer.serializeToString(xmlDoc);
    newZip.file(xmlPath, newXmlText);
  }
  
  return await newZip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

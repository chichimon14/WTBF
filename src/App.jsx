import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  UploadCloud, 
  FileText, 
  Settings, 
  Sparkles, 
  Download, 
  RefreshCw, 
  HelpCircle,
  CheckCircle2,
  FileArchive,
  FolderOpen,
  Save,
  X,
  Edit3,
  Bookmark,
  Layers,
  FolderPlus,
  BookOpen,
  Folder,
  ArrowRight,
  ArrowLeft,
  Sliders
} from 'lucide-react';
import { parseDocxHighlights, replaceDocxHighlights, cleanPromptText } from './utils/docxHelper';
import JSZip from 'jszip';

// 初始默认的字段示例
const INITIAL_DATA_LIST = [
  { id: '1', label: '姓名', value: '张三' },
  { id: '2', label: '身份证号', value: '110101199001011234' },
  { id: '3', label: '联系电话', value: '13812345678' },
  { id: '4', label: '家庭住址', value: '北京市朝阳区幸福路88号' },
  { id: '5', label: '甲方名称', value: '北京极智科技有限公司' },
];

const INITIAL_PROJECTS = [
  { 
    id: 'default', 
    name: '默认联合填充项目', 
    templateIds: [],
    dataList: INITIAL_DATA_LIST,
    mappings: {}
  }
];

// 智能截断长文件名的辅助函数
const formatFileName = (fileName, maxLength = 18) => {
  if (!fileName || fileName.length <= maxLength) return fileName;
  
  const extIdx = fileName.lastIndexOf('.');
  const ext = extIdx > -1 ? fileName.substring(extIdx) : '';
  const base = extIdx > -1 ? fileName.substring(0, extIdx) : fileName;
  
  if (base.length <= maxLength) return fileName;
  
  const keepStart = Math.ceil(maxLength * 0.65);
  const keepEnd = Math.floor(maxLength * 0.35);
  
  return base.substring(0, keepStart) + '...' + base.substring(base.length - keepEnd) + ext;
};

export default function App() {
  // --- 状态管理 ---
  const [currentStep, setCurrentStep] = useState(1);
  const [templates, setTemplates] = useState([]);
  
  const [projects, setProjects] = useState(() => {
    const cached = localStorage.getItem('word_filler_projects');
    return cached ? JSON.parse(cached) : INITIAL_PROJECTS;
  });

  const [activeProjectId, setActiveProjectId] = useState(() => {
    const cached = localStorage.getItem('word_filler_active_project_id');
    return cached || 'default';
  });

  const [newProjectName, setNewProjectName] = useState('');
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [showPathModal, setShowPathModal] = useState(false);

  // --- 文件夹路径配置状态 ---
  const [templateDir, setTemplateDir] = useState(() => {
    return localStorage.getItem('word_filler_template_dir') || 'C:\\WordFiller\\Templates';
  });
  const [outputDir, setOutputDir] = useState(() => {
    return localStorage.getItem('word_filler_output_dir') || 'C:\\WordFiller\\Output';
  });

  // 辅助运行状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // DOM 引用
  const fileInputRef = useRef(null);
  const projectInputRef = useRef(null);

  const isElectron = !!(window && window.ipcRenderer);

  // --- 脏数据自愈升级机制 ---
  useEffect(() => {
    let hasDirtyData = false;
    const repairedProjects = projects.map(p => {
      let modified = false;
      const updated = { ...p };
      
      if (!p.dataList || !Array.isArray(p.dataList)) {
        updated.dataList = INITIAL_DATA_LIST;
        modified = true;
      }
      if (!p.mappings || typeof p.mappings !== 'object') {
        updated.mappings = {};
        modified = true;
      }
      if (!p.templateIds || !Array.isArray(p.templateIds)) {
        updated.templateIds = [];
        modified = true;
      }
      
      if (modified) {
        hasDirtyData = true;
      }
      return updated;
    });

    if (hasDirtyData) {
      setProjects(repairedProjects);
      console.log('检测到历史残留脏数据，系统已完成在线安全清洗与升级修复。');
    }
  }, []);

  // --- 本地缓存同步 ---
  useEffect(() => {
    localStorage.setItem('word_filler_projects', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('word_filler_active_project_id', activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    localStorage.setItem('word_filler_template_dir', templateDir);
  }, [templateDir]);

  useEffect(() => {
    localStorage.setItem('word_filler_output_dir', outputDir);
  }, [outputDir]);

  // 同步重置当前激活项目，防止越界
  useEffect(() => {
    if (!projects.some(p => p.id === activeProjectId)) {
      setActiveProjectId(projects[0]?.id || 'default');
    }
  }, [projects]);

  // --- 调用 Electron 原生文件夹选择对话框 ---
  const handleSelectFolder = async (type) => {
    if (isElectron) {
      window.ipcRenderer.send('select-directory', type);
    } else {
      const newPath = window.prompt(
        `【网页版受浏览器安全沙箱限制，无法直接调用系统目录选择】\n` +
        `打包成 Windows 桌面端 (.exe) 后，点击此处可直接弹出系统文件夹选择框。\n\n` +
        `您可以在此手动修改路径标识：`, 
        type === 'template' ? templateDir : outputDir
      );
      if (newPath) {
        if (type === 'template') setTemplateDir(newPath);
        else setOutputDir(newPath);
      }
    }
  };

  // 监听 Electron 目录选择返回
  useEffect(() => {
    if (isElectron && window.ipcRenderer) {
      const handleSelectedDir = (event, { type, path }) => {
        if (type === 'template') setTemplateDir(path);
        else setOutputDir(path);
        setSuccessMsg(`已成功将本地目录配置为: ${path}`);
      };
      window.ipcRenderer.on('selected-directory', handleSelectedDir);
      return () => {
        window.ipcRenderer.removeListener('selected-directory', handleSelectedDir);
      };
    }
  }, [isElectron]);

  // --- 智能模糊推荐算法 ---
  const findBestMatch = (promptText, currentDataList) => {
    if (!promptText || currentDataList.length === 0) return '';
    const cleanWord = promptText.toLowerCase().replace(/[\[\]\s【】\(\)（）:：_\*]/g, '');
    
    let bestMatchId = '';
    let maxSimilarity = 0;
    
    for (const item of currentDataList) {
      if (!item.label) continue;
      const cleanLabel = item.label.toLowerCase().replace(/[\[\]\s【】\(\)（）:：_\*]/g, '');
      
      if (cleanWord === cleanLabel) return item.id;
      
      if (cleanWord.includes(cleanLabel) || cleanLabel.includes(cleanWord)) {
        const similarity = Math.min(cleanLabel.length, cleanWord.length) / Math.max(cleanLabel.length, cleanWord.length);
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          bestMatchId = item.id;
        }
      }
    }
    return maxSimilarity > 0.2 ? bestMatchId : '';
  };

  // --- 当前项目安全提取 ---
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0] || INITIAL_PROJECTS[0];
  const activeProjectTemplates = templates.filter(t => activeProject?.templateIds?.includes(t.id) || false);
  const activeProjectDataList = activeProject?.dataList || [];

  // --- 数据项管理 ---
  const handleAddRow = () => {
    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        const currentData = p.dataList || [];
        const nextId = (Math.max(...currentData.map(item => parseInt(item.id) || 0), 0) + 1).toString();
        return {
          ...p,
          dataList: [...currentData, { id: nextId, label: '', value: '' }]
        };
      }
      return p;
    }));
  };

  const handleUpdateRow = (id, field, value) => {
    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        const currentData = p.dataList || [];
        const updatedData = currentData.map(item => item.id === id ? { ...item, [field]: value } : item);
        
        const updatedMappings = { ...p.mappings };
        const templateIds = p.templateIds || [];
        templateIds.forEach(tplId => {
          const tpl = templates.find(t => t.id === tplId);
          if (tpl) {
            const tplMap = { ...updatedMappings[tplId] };
            const allPrompts = [...(tpl.highlights || []), ...(tpl.stars || [])];
            allPrompts.forEach(pr => {
              if (!tplMap[pr]) {
                tplMap[pr] = findBestMatch(pr, updatedData);
              }
            });
            updatedMappings[tplId] = tplMap;
          }
        });

        return {
          ...p,
          dataList: updatedData,
          mappings: updatedMappings
        };
      }
      return p;
    }));
  };

  const handleRemoveRow = (id) => {
    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        const currentData = p.dataList || [];
        const updatedData = currentData.filter(item => item.id !== id);
        
        const updatedMappings = { ...p.mappings };
        const templateIds = p.templateIds || [];
        templateIds.forEach(tplId => {
          const tplMap = { ...updatedMappings[tplId] };
          for (const [pr, dataId] of Object.entries(tplMap)) {
            if (dataId === id) {
              tplMap[pr] = '';
            }
          }
          updatedMappings[tplId] = tplMap;
        });

        return {
          ...p,
          dataList: updatedData,
          mappings: updatedMappings
        };
      }
      return p;
    }));
  };

  const handleResetData = () => {
    if (window.confirm('您确定要清空当前项目已录入的数据吗？')) {
      setProjects(prev => prev.map(p => {
        if (p.id === activeProjectId) {
          return {
            ...p,
            dataList: [{ id: '1', label: '', value: '' }]
          };
        }
        return p;
      }));
    }
  };

  // --- 工作项目定义 (步骤 1) ---
  const handleCreateProject = (e) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    
    const projectId = Math.random().toString(36).substring(2, 9);
    const newProj = {
      id: projectId,
      name: newProjectName.trim(),
      templateIds: [],
      dataList: [{ id: '1', label: '姓名', value: '' }], 
      mappings: {}
    };
    
    setProjects([...projects, newProj]);
    setActiveProjectId(projectId);
    setNewProjectName('');
    setSuccessMsg(`工作项目 "${newProj.name}" 创建并激活！您现在可以直接在右侧录入它的字段备注名称。`);
  };

  const handleToggleTemplateInProject = (projectId, templateId) => {
    setProjects(prev => prev.map(p => {
      if (p.id === projectId) {
        const templateIds = [...(p.templateIds || [])];
        const idx = templateIds.indexOf(templateId);
        const updatedMappings = { ...p.mappings };
        
        if (idx > -1) {
          templateIds.splice(idx, 1);
          delete updatedMappings[templateId];
        } else {
          templateIds.push(templateId);
          const tpl = templates.find(t => t.id === templateId);
          if (tpl) {
            const tplMap = {};
            const allPrompts = [...(tpl.highlights || []), ...(tpl.stars || [])];
            allPrompts.forEach(pr => {
              tplMap[pr] = findBestMatch(pr, p.dataList || []);
            });
            updatedMappings[templateId] = tplMap;
          }
        }
        return { ...p, templateIds, mappings: updatedMappings };
      }
      return p;
    }));
  };

  const handleRenameProject = (projectId) => {
    const proj = projects.find(p => p.id === projectId);
    const newName = window.prompt('请输入新的项目名称：', proj.name);
    if (newName && newName.trim()) {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, name: newName.trim() } : p));
    }
  };

  const handleRemoveProject = (projectId) => {
    if (projectId === 'default') {
      alert('默认项目是系统初始项，不能被删除。');
      return;
    }
    if (window.confirm('确定要删除该工作项目吗？（模板库文件依然保留，仅清除该项目配置）')) {
      setProjects(projects.filter(p => p.id !== projectId));
    }
  };

  // --- 项目一键导入导出 (.wjproj) ---
  const handleExportProject = async () => {
    if (templates.length === 0 && projects.length === 1 && activeProjectDataList.length === 1 && !activeProjectDataList[0].label) {
      setErrorMsg('没有可以导出的项目内容！');
      return;
    }

    try {
      const zip = new JSZip();
      
      const config = {
        projects: projects,
        activeProjectId: activeProjectId,
        templatesMeta: templates.map(t => ({
          id: t.id,
          fileName: t.fileName,
          highlights: t.highlights || [],
          stars: t.stars || [],
          xmlFiles: t.xmlFiles || []
        }))
      };
      
      zip.file('project_config.json', JSON.stringify(config));
      
      const tplFolder = zip.folder('templates');
      for (const tpl of templates) {
        const docxContent = await tpl.zipInstance.generateAsync({ type: 'uint8array' });
        tplFolder.file(`${tpl.id}_${tpl.fileName}`, docxContent);
      }
      
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      
      a.href = url;
      a.download = `Word填充项目备份_${timestamp}.wjproj`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setSuccessMsg('备份文件已打包下载！可将该 .wjproj 项目拖拽回软件一秒还原。');
    } catch (err) {
      console.error(err);
      setErrorMsg('打包项目时出错。');
    }
  };

  const handleImportProject = async (file) => {
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      
      const configFile = zip.file('project_config.json');
      if (!configFile) {
        throw new Error('未检测到项目元数据 project_config.json 文件！');
      }
      
      const configText = await configFile.async('text');
      const config = JSON.parse(configText);
      const loadedTemplates = [];
      
      if (config.templatesMeta && config.templatesMeta.length > 0) {
        for (const meta of config.templatesMeta) {
          const docxFile = zip.file(`templates/${meta.id}_${meta.fileName}`);
          if (!docxFile) {
            throw new Error(`找不到原模板文件: ${meta.fileName}`);
          }
          
          const docxBuffer = await docxFile.async('uint8array');
          const docxZip = await JSZip.loadAsync(docxBuffer);
          
          loadedTemplates.push({
            id: meta.id,
            fileName: meta.fileName,
            zipInstance: docxZip,
            xmlFiles: meta.xmlFiles || [],
            highlights: meta.highlights || [],
            stars: meta.stars || [],
            mappings: {}
          });
        }
      }
      
      setProjects(config.projects || INITIAL_PROJECTS);
      setActiveProjectId(config.activeProjectId || 'default');
      setTemplates(loadedTemplates);
      setSuccessMsg('项目包导入成功！数据与关联模板已还原。');
      setCurrentStep(3);
    } catch (err) {
      console.error(err);
      setErrorMsg(`项目导入失败：${err.message}`);
    }
  };

  // --- 模板库文件管理与拖拽 (步骤 2) ---
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => {
    setIsDragActive(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragActive(false);
    setErrorMsg('');
    setSuccessMsg('');
    
    const files = Array.from(e.dataTransfer.files);
    const projectFile = files.find(f => f.name.endsWith('.wjproj') || (f.name.endsWith('.zip') && !f.name.includes('[已填写]')));
    if (projectFile) {
      await handleImportProject(projectFile);
      return;
    }
    
    const docxFiles = files.filter(f => f.name.endsWith('.docx'));
    if (docxFiles.length > 0) {
      await processDocxFiles(docxFiles);
    } else {
      setErrorMsg('请上传后缀为 .docx 的 Word 文件或 .wjproj 项目包！');
    }
  };

  const handleFileSelect = async (e) => {
    setErrorMsg('');
    setSuccessMsg('');
    const files = Array.from(e.target.files).filter(f => f.name.endsWith('.docx'));
    if (files.length > 0) {
      await processDocxFiles(files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleProjectSelect = async (e) => {
    setErrorMsg('');
    setSuccessMsg('');
    const file = e.target.files[0];
    if (file) {
      await handleImportProject(file);
    }
    if (projectInputRef.current) projectInputRef.current.value = '';
  };

  const processDocxFiles = async (files) => {
    const newTemplates = [];
    
    for (const file of files) {
      if (templates.some(t => t.fileName === file.name)) {
        continue;
      }
      
      try {
        const parsed = await parseDocxHighlights(file);
        
        const newTpl = {
          id: Math.random().toString(36).substring(2, 9),
          fileName: parsed.fileName,
          zipInstance: parsed.zipInstance,
          xmlFiles: parsed.xmlFiles || [],
          highlights: parsed.highlights || [],
          stars: parsed.stars || []
        };
        newTemplates.push(newTpl);

        // 导入新模板，自动勾选并合并至当前项目
        setProjects(prev => prev.map(p => {
          const templateIds = p.templateIds || [];
          if (p.id === activeProjectId && !templateIds.includes(newTpl.id)) {
            const updatedIds = [...templateIds, newTpl.id];
            const updatedMappings = { ...p.mappings };
            const tplMap = {};
            const allPrompts = [...(newTpl.highlights || []), ...(newTpl.stars || [])];
            allPrompts.forEach(pr => {
              tplMap[pr] = findBestMatch(pr, p.dataList || []);
            });
            updatedMappings[newTpl.id] = tplMap;
            return { ...p, templateIds: updatedIds, mappings: updatedMappings };
          }
          return p;
        }));

      } catch (err) {
        setErrorMsg(err.message || '文档解析错误');
      }
    }

    if (newTemplates.length > 0) {
      setTemplates(prev => [...prev, ...newTemplates]);
      setSuccessMsg(`成功导入 ${newTemplates.length} 个模板，并已自动合并绑定至当前项目 "${activeProject.name}"！`);
    }
  };

  const handleRemoveTemplate = (id) => {
    if (window.confirm('确定要从全局模板库中彻底删除该文件吗？（其他项目如果勾选了该模板也将一并被移除）')) {
      setTemplates(prev => prev.filter(t => t.id !== id));
      setProjects(prev => prev.map(p => {
        const templateIds = (p.templateIds || []).filter(tid => tid !== id);
        const updatedMappings = { ...p.mappings };
        delete updatedMappings[id];
        return { ...p, templateIds, mappings: updatedMappings };
      }));
      if (activeTemplateId === id) setActiveTemplateId(null);
    }
  };

  // --- 弹窗映射修改 ---
  const handleMappingChange = (templateId, promptText, dataId) => {
    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        const projectMappings = p.mappings || {};
        const templateMappings = { ...(projectMappings[templateId] || {}), [promptText]: dataId };
        
        return {
          ...p,
          mappings: {
            ...projectMappings,
            [templateId]: templateMappings
          }
        };
      }
      return p;
    }));
  };

  const handleAutoMatchInPopup = () => {
    if (!activeTemplate) return;
    setProjects(prev => prev.map(p => {
      if (p.id === activeProjectId) {
        const projectMappings = p.mappings || {};
        const templateMappings = { ...(projectMappings[activeTemplate.id] || {}) };
        
        const allPrompts = [...(activeTemplate.highlights || []), ...(activeTemplate.stars || [])];
        allPrompts.forEach(pr => {
          if (!templateMappings[pr]) {
            templateMappings[pr] = findBestMatch(pr, p.dataList || []);
          }
        });
        
        return {
          ...p,
          mappings: {
            ...projectMappings,
            [activeTemplate.id]: templateMappings
          }
        };
      }
      return p;
    }));
  };

  // --- 一键替换生成 ---
  const handleGenerate = async () => {
    if (activeProjectTemplates.length === 0) {
      setErrorMsg('当前工作项目没有关联任何 Word 模板，请在【步骤二】勾选或导入模板！');
      return;
    }
    
    setIsGenerating(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const valueMap = {};
      activeProjectDataList.forEach(item => {
        valueMap[item.id] = item.value || '';
      });

      const generatedFiles = [];

      for (const tpl of activeProjectTemplates) {
        const replaceMap = {};
        const allPrompts = [...(tpl.highlights || []), ...(tpl.stars || [])];
        
        allPrompts.forEach(p => {
          const projectMappings = activeProject.mappings || {};
          const tplMappings = projectMappings[tpl.id] || {};
          const boundDataId = tplMappings[p];
          replaceMap[p] = boundDataId ? valueMap[boundDataId] : '';
        });

        const modifiedBlob = await replaceDocxHighlights(tpl.zipInstance, tpl.xmlFiles || [], replaceMap);
        generatedFiles.push({
          name: tpl.fileName,
          blob: modifiedBlob
        });
      }

      if (isElectron && window.ipcRenderer) {
        const filesData = [];
        for (const file of generatedFiles) {
          const buffer = await file.blob.arrayBuffer();
          filesData.push({
            name: file.name,
            buffer: Array.from(new Uint8Array(buffer))
          });
        }
        window.ipcRenderer.send('write-output-files', { files: filesData, outputDir });
      } else {
        if (generatedFiles.length === 1) {
          const file = generatedFiles[0];
          const url = URL.createObjectURL(file.blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `[生成]_${file.name}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setSuccessMsg(`Word 填充替换成功！已为您下载文件。`);
        } else {
          const zip = new JSZip();
          generatedFiles.forEach(file => {
            zip.file(file.name, file.blob);
          });

          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(zipBlob);
          const a = document.createElement('a');
          const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          a.href = url;
          a.download = `${activeProject.name}_一键合并输出_${timestamp}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          setSuccessMsg(`打包合并生成成功！共 ${generatedFiles.length} 个文档已打包为 ZIP 下载。`);
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('生成文档过程中出错，请检查模板。');
    } finally {
      setIsGenerating(false);
    }
  };

  // 监听桌面端写入成功的回调
  useEffect(() => {
    if (isElectron && window.ipcRenderer) {
      const handleWriteResult = (event, { success, count, error }) => {
        if (success) {
          setSuccessMsg(`一键生成成功！已成功将 ${count} 个 Word 文件写入至指定路径: ${outputDir}`);
        } else {
          setErrorMsg(`写入文件失败：${error}`);
        }
      };
      window.ipcRenderer.on('write-files-result', handleWriteResult);
      return () => {
        window.ipcRenderer.removeListener('write-files-result', handleWriteResult);
      };
    }
  }, [isElectron, outputDir]);

  // --- 弹窗辅助 ---
  const activeTemplate = templates.find(t => t.id === activeTemplateId);
  const activeTemplatePromptsCount = activeTemplate 
    ? (activeTemplate.highlights || []).length + (activeTemplate.stars || []).length 
    : 0;

  const getBoundCount = (tpl) => {
    let count = 0;
    const allPrompts = [...(tpl.highlights || []), ...(tpl.stars || [])];
    const projectMappings = activeProject?.mappings || {};
    const tplMappings = projectMappings[tpl.id] || {};
    allPrompts.forEach(p => {
      if (tplMappings[p]) count++;
    });
    return count;
  };

  return (
    <div className="app-container">
      {/* 顶部 Header */}
      <header className="app-header">
        <div className="header-title-section">
          <div className="app-logo">📝</div>
          <div>
            <h1 className="app-title">Word 智能格式填充系统</h1>
            <p className="app-subtitle">手打星号(***)与高亮极速解析，数据隔离随项目打包</p>
          </div>
        </div>
        
        {/* 顶部操作区 */}
        <div className="btn-group">
          <button className="btn btn-secondary" onClick={() => projectInputRef.current && projectInputRef.current.click()}>
            <FolderOpen size={16} /> 导入项目 (.wjproj)
          </button>
          <input 
            type="file" 
            ref={projectInputRef} 
            onChange={handleProjectSelect} 
            style={{ display: 'none' }} 
            accept=".wjproj,.zip"
          />

          <button className="btn btn-secondary" onClick={handleExportProject}>
            <Save size={16} /> 导出项目备份
          </button>

          <button className="btn btn-primary" onClick={() => setShowPathModal(true)}>
            <Sliders size={16} /> 路径配置
          </button>
        </div>
      </header>

      {/* 顶部向导式三步 Stepper 指示器 */}
      <div className="stepper-container">
        <div 
          className={`step-item ${currentStep === 1 ? 'active' : ''} ${currentStep > 1 ? 'completed' : ''}`}
          onClick={() => setCurrentStep(1)}
        >
          <div className="step-number">1</div>
          <div className="step-label">📦 01. 确定项目与录入数据</div>
        </div>
        <div className="step-line"></div>
        <div 
          className={`step-item ${currentStep === 2 ? 'active' : ''} ${currentStep > 2 ? 'completed' : ''}`}
          onClick={() => setCurrentStep(2)}
        >
          <div className="step-number">2</div>
          <div className="step-label">📄 02. 选取与配置模板</div>
        </div>
        <div className="step-line"></div>
        <div 
          className={`step-item ${currentStep === 3 ? 'active' : ''}`}
          onClick={() => setCurrentStep(3)}
        >
          <div className="step-number">3</div>
          <div className="step-label">🚀 03. 确认数据并一键生成</div>
        </div>
      </div>

      {/* 消息通知横幅 */}
      {errorMsg && (
        <div className="guide-banner" style={{ backgroundColor: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b', marginTop: 0 }}>
          <div className="guide-content">
            <h4>错误提示</h4>
            <p style={{ color: '#b91c1c' }}>{errorMsg}</p>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="guide-banner" style={{ backgroundColor: '#d1fae5', borderColor: '#a7f3d0', color: '#065f46', marginTop: 0 }}>
          <CheckCircle2 className="guide-icon" style={{ color: '#059669' }} size={20} />
          <div className="guide-content">
            <h4 style={{ color: '#065f46' }}>操作成功</h4>
            <p style={{ color: '#047857' }}>{successMsg}</p>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 📦 步骤 1：确定当前项目与数据录入 (1:1 等宽对称布局) */}
      {/* ======================================================== */}
      {currentStep === 1 && (
        <main className="main-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          
          {/* 左侧：工作项目定义与选择 */}
          <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div>
              <div className="card-header">
                <h2 className="card-title">
                  <FolderPlus size={18} className="guide-icon" style={{ color: 'var(--primary)' }} />
                  已有项目选择 & 新建项目
                </h2>
              </div>
              
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                请在下方点击选择激活您的工作项目，或者新建一个独立数据沙箱项目。
              </p>

              {/* 已有项目卡片 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
                {projects.map(p => {
                  const isActive = activeProjectId === p.id;

                  return (
                    <div 
                      key={p.id} 
                      className="template-card" 
                      style={{ 
                        border: isActive ? '2px solid var(--primary)' : '1px solid var(--border)',
                        backgroundColor: isActive ? 'var(--primary-light)' : 'white',
                        cursor: 'pointer'
                      }}
                      onClick={() => setActiveProjectId(p.id)}
                    >
                      <div className="template-card-summary" style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '700', fontSize: '0.95rem', color: 'var(--text-main)' }}>
                            {p.name} {isActive && <span style={{ color: 'var(--primary)', fontSize: '0.8rem' }}>(激活中)</span>}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                            包含字段: {p.dataList?.length || 0} 个 | 已合并模板: {p.templateIds?.length || 0} 个
                          </div>
                        </div>

                        <div className="template-meta" onClick={(e) => e.stopPropagation()}>
                          <button 
                            className="card-action-btn" 
                            onClick={() => handleRenameProject(p.id)}
                            style={{ fontSize: '0.75rem' }}
                          >
                            重命名
                          </button>

                          <button 
                            className="card-action-btn" 
                            onClick={() => handleRemoveProject(p.id)}
                            style={{ color: 'var(--danger)', fontSize: '0.75rem', display: p.id === 'default' ? 'none' : 'inline-block' }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 新建项目表单 */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem', marginTop: '1.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: '0.75rem' }}>创建新项目：</h3>
                <form onSubmit={handleCreateProject} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="业务项目名 (如: 海关退税B包)"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                    <Plus size={16} /> 创建
                  </button>
                </form>
              </div>
            </div>
          </section>

          {/* 右侧：当前激活项目的数据录入表格 */}
          <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
            <div>
              <div className="card-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 className="card-title">
                    <Settings size={18} className="guide-icon" style={{ color: 'var(--primary)' }} />
                    字段与具体数值录入
                  </h2>
                  <button className="card-action-btn" onClick={handleResetData}>
                    清空列表
                  </button>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  当前编辑项目: <strong style={{ color: 'var(--primary)' }}>{activeProject?.name}</strong>
                </div>
              </div>

              <div className="data-table-wrapper" style={{ maxHeight: '420px' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px', textAlign: 'center' }}>编号</th>
                      <th>字段备注名称</th>
                      <th>输入替换数值</th>
                      <th style={{ width: '50px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeProjectDataList.map((item, index) => (
                      <tr key={item.id}>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <span className="input-index">{index + 1}</span>
                          </div>
                        </td>
                        <td>
                          <input 
                            type="text" 
                            className="input-field" 
                            value={item.label}
                            onChange={(e) => handleUpdateRow(item.id, 'label', e.target.value)}
                            placeholder="如: 甲方名称"
                          />
                        </td>
                        <td>
                          <input 
                            type="text" 
                            className="input-field" 
                            value={item.value}
                            onChange={(e) => handleUpdateRow(item.id, 'value', e.target.value)}
                            placeholder="输入填充值"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && index === activeProjectDataList.length - 1) {
                                handleAddRow();
                              }
                            }}
                          />
                        </td>
                        <td>
                          <button 
                            className="btn-icon-only" 
                            onClick={() => handleRemoveRow(item.id)}
                            disabled={activeProjectDataList.length <= 1}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button 
                className="btn btn-secondary" 
                onClick={handleAddRow}
                style={{ width: '100%', marginTop: '1.25rem', borderStyle: 'dashed' }}
              >
                <Plus size={16} /> 添加一行新数据字段 (键盘 Enter)
              </button>
            </div>

            {/* 右侧底部双按钮并排 */}
            <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1rem' }}>
              <button 
                className="btn btn-success"
                onClick={() => {
                  setSuccessMsg("项目字段和数值暂存成功！");
                }}
                style={{ flex: 1, padding: '0.75rem', fontWeight: '700' }}
              >
                <Save size={16} /> 仅保存修改
              </button>
              <button 
                className="btn btn-primary"
                onClick={() => {
                  setSuccessMsg("保存成功！已进入步骤二。");
                  setCurrentStep(2);
                }}
                style={{ flex: 1.2, padding: '0.75rem', fontWeight: '700' }}
              >
                配置项目模板 (下一步) →
              </button>
            </div>
          </section>

        </main>
      )}

      {/* ======================================================== */}
      {/* 📄 步骤 2：选取与配置模板 (1:1:1 三栏等宽流水线，取消底部小条，将按钮直接归档于三栏内部) */}
      {/* ======================================================== */}
      {currentStep === 2 && (
        <main className="main-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          
          {/* 第一栏：模板选取 (1/3 宽度) */}
          <section className="glass-card" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
            <div>
              <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}>
                <h2 className="card-title" style={{ fontSize: '1rem' }}>
                  <Layers size={16} className="guide-icon" style={{ color: 'var(--primary)' }} />
                  1. 选取已有模板
                </h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  当前项目: <strong style={{ color: 'var(--primary)' }}>{activeProject?.name}</strong>
                </div>
              </div>

              {templates.length === 0 ? (
                <div className="empty-state" style={{ padding: '1.5rem 0.5rem' }}>
                  <FileText className="empty-state-icon" size={32} />
                  <p className="empty-state-text" style={{ fontSize: '0.8rem' }}>库中暂无模板</p>
                  <p className="empty-state-subtext" style={{ fontSize: '0.7rem' }}>请在右侧拖入您的第一个 Word 模板。</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '310px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                  {templates.map(tpl => {
                    const templateIds = activeProject?.templateIds || [];
                    const isChecked = templateIds.includes(tpl.id);

                    return (
                      <label 
                        key={tpl.id} 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '0.5rem', 
                          padding: '0.65rem 0.75rem', 
                          background: isChecked ? '#f0fdf4' : '#f8fafc',
                          border: isChecked ? '1px solid #bbf7d0' : '1px solid var(--border)',
                          borderRadius: 'var(--radius-md)',
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'all 0.2s',
                          minWidth: 0
                        }}
                      >
                        <input 
                          type="checkbox" 
                          style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                          checked={isChecked}
                          onChange={() => handleToggleTemplateInProject(activeProjectId, tpl.id)}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div 
                            style={{ fontWeight: '600', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} 
                            title={tpl.fileName}
                          >
                            {formatFileName(tpl.fileName, 14)}
                          </div>
                        </div>
                        
                        <button 
                          type="button"
                          className="card-action-btn"
                          style={{ color: 'var(--danger)', fontSize: '0.75rem', padding: '0.15rem', flexShrink: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleRemoveTemplate(tpl.id);
                          }}
                        >
                          删除
                        </button>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 将 “上一步” 精致收纳于第一栏底部，达成对称 */}
            <div style={{ marginTop: '2.5rem' }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setCurrentStep(1)}
                style={{ width: '100%', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.65rem' }}
              >
                <ArrowLeft size={16} /> 上一步 修改数据字段
              </button>
            </div>
          </section>

          {/* 第二栏：创建/拖入新模板 (1/3 宽度) */}
          <section className="glass-card" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
            <div>
              <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}>
                <h2 className="card-title" style={{ fontSize: '1rem' }}>
                  <UploadCloud size={16} className="guide-icon" style={{ color: 'var(--success)' }} />
                  2. 导入新 Word 模板
                </h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  导入文件将直接与当前项目进行勾选关联。
                </div>
              </div>

              <div 
                className={`dropzone ${isDragActive ? 'drag-active' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                style={{ padding: '2rem 1rem', height: '160px', display: 'flex', justifyContent: 'center' }}
              >
                <UploadCloud className="dropzone-icon" size={28} />
                <p className="dropzone-text" style={{ fontSize: '0.8rem' }}>拖放或点击上传 Word 文件</p>
                <p className="dropzone-subtext" style={{ fontSize: '0.65rem' }}>自动读取黄色高亮与 `***` 标记</p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileSelect} 
                  style={{ display: 'none' }} 
                  multiple 
                  accept=".docx"
                />
              </div>
            </div>
            
            <div className="guide-banner" style={{ marginTop: '1.5rem', padding: '0.55rem 0.75rem' }}>
              <HelpCircle className="guide-icon" size={13} style={{ color: '#ca8a04', marginTop: 0 }} />
              <div className="guide-content">
                <p style={{ fontSize: '0.675rem', color: '#a16207', lineHeight: '1.2' }}>
                  在 Word 模板中打字输入三个及以上星号（如 `***`），系统即识别为需填充项。
                </p>
              </div>
            </div>
          </section>

          {/* 第三栏：关联模板映射配置 (1/3 宽度) */}
          <section className="glass-card" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
            <div>
              <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}>
                <h2 className="card-title" style={{ fontSize: '1rem' }}>
                  <Bookmark size={16} className="guide-icon" style={{ color: 'var(--primary)' }} />
                  3. 字段映射绑定配置
                </h2>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  点击配置按钮，绑定星号/高亮和字段编号
                </div>
              </div>

              {activeProjectTemplates.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '2rem 1rem', background: '#f8fafc', borderRadius: '6px', textAlign: 'center', border: '1px dashed var(--border)' }}>
                  尚未包含任何模板。请从第一栏勾选或第二栏上传文件。
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', paddingRight: '0.15rem' }}>
                  {activeProjectTemplates.map(tpl => {
                    const totalPrompts = (tpl.highlights || []).length + (tpl.stars || []).length;
                    const boundCount = getBoundCount(tpl);
                    const isConfigured = totalPrompts > 0 && boundCount === totalPrompts;

                    return (
                      <div key={tpl.id} className="template-card" style={{ padding: '0.55rem 0.75rem', minWidth: 0 }}>
                        <div className="template-card-summary" style={{ padding: 0, minWidth: 0 }}>
                          <div className="template-info" style={{ gap: '0.35rem', flex: 1.1, minWidth: 0 }}>
                            <FileText size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                            <span 
                              className="template-name" 
                              style={{ fontSize: '0.775rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} 
                              title={tpl.fileName}
                            >
                              {formatFileName(tpl.fileName, 14)}
                            </span>
                          </div>
                          <div className="template-meta" style={{ gap: '0.35rem', flexShrink: 0 }}>
                            <span className={`badge ${isConfigured ? 'badge-success' : 'badge-neutral'}`} style={{ padding: '0.1rem 0.25rem', fontSize: '0.65rem' }}>
                              {boundCount}/{totalPrompts}
                            </span>
                            <button 
                              className="btn btn-secondary" 
                              onClick={() => setActiveTemplateId(tpl.id)}
                              style={{ padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}
                            >
                              配置
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 将 “下一步” 按钮直接收纳于第三栏底部，彻底去除页面最底下的悬空横长条，界面极致净空美观 */}
            <div style={{ marginTop: '2.5rem' }}>
              <button 
                className="btn btn-primary"
                onClick={() => {
                  setCurrentStep(3);
                }}
                style={{ width: '100%', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.65rem', fontWeight: '700' }}
              >
                确认并生成 (下一步) <ArrowRight size={16} />
              </button>
            </div>
          </section>

        </main>
      )}

      {/* ======================================================== */}
      {/* 🚀 步骤 3：数据摘要只读确认与一键生成 */}
      {/* ======================================================== */}
      {currentStep === 3 && (
        <main className="main-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          
          {/* 左栏：数据只读校验 */}
          <section className="glass-card">
            <div className="card-header">
              <h2 className="card-title">
                <CheckCircle2 size={18} className="guide-icon" style={{ color: 'var(--primary)' }} />
                1. 录入数据摘要确认 (只读)
              </h2>
            </div>
            
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              请在此进行最后的关键数值校验。如需修改，请点击最下方按钮返回“步骤一”。
            </p>

            <div className="data-table-wrapper" style={{ maxHeight: '420px', background: '#fafbfc' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '60px', textAlign: 'center' }}>编号</th>
                    <th>数据字段名称</th>
                    <th>即将填充的数值</th>
                  </tr>
                </thead>
                <tbody>
                  {activeProjectDataList.map((item, index) => (
                    <tr key={item.id} style={{ backgroundColor: item.value ? 'white' : '#fffbeb' }}>
                      <td>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <span className="input-index">{index + 1}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.85rem', fontWeight: '700', padding: '0.35rem 0' }}>{item.label || <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>(未命名)</span>}</div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.85rem', color: item.value ? 'var(--text-main)' : '#b45309', padding: '0.35rem 0', wordBreak: 'break-all' }}>
                          {item.value || <span style={{ fontStyle: 'italic', fontWeight: '500' }}>[空白，将不替换占位符]</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '2rem' }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setCurrentStep(1)}
                style={{ width: '100%', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <ArrowLeft size={16} /> 返回步骤一 修改数据字段
              </button>
            </div>
          </section>

          {/* 右栏：发车生成控制台 */}
          <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyBlock: 'space-between', height: '100%' }}>
            <div>
              <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 className="card-title">
                    <Layers size={18} className="guide-icon" style={{ color: 'var(--success)' }} />
                    2. 一键填充并合并导出
                  </h2>
                  <span className="badge badge-success">
                    共 {activeProjectTemplates.length} 份文档
                  </span>
                </div>
              </div>
              
              {/* 输出清单 */}
              <div style={{ marginBottom: '1.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>项目 <strong>"{activeProject?.name}"</strong> 包含以下待生成文件：</span>
                
                <div className="templates-list" style={{ maxHeight: '180px', overflowY: 'auto', marginTop: '0.5rem', paddingRight: '0.15rem' }}>
                  {activeProjectTemplates.map(tpl => {
                    const totalPrompts = (tpl.highlights || []).length + (tpl.stars || []).length;
                    const boundCount = getBoundCount(tpl);

                    return (
                      <div key={tpl.id} className="template-card" style={{ padding: '0.55rem 0.75rem' }}>
                        <div className="template-card-summary" style={{ padding: 0 }}>
                          <div className="template-info" style={{ gap: '0.5rem', minWidth: 0 }}>
                            <FileText size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                            <span 
                              className="template-name" 
                              style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} 
                              title={tpl.fileName}
                            >
                              {formatFileName(tpl.fileName, 24)}
                            </span>
                          </div>
                          <span className="badge badge-neutral" style={{ fontSize: '0.675rem', flexShrink: 0 }}>
                            绑定: {boundCount}/{totalPrompts}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 物理路径 */}
              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div>📁 <strong>物理模板目录：</strong><span style={{ fontFamily: 'monospace' }}>{templateDir}</span></div>
                  <div>📂 <strong>一键导出目录：</strong><span style={{ fontFamily: 'monospace' }}>{outputDir}</span></div>
                </div>
              </div>
            </div>

            <div>
              <button 
                className="btn btn-success" 
                onClick={handleGenerate}
                disabled={isGenerating || activeProjectTemplates.length === 0}
                style={{ width: '100%', padding: '0.95rem 1.5rem', fontSize: '1.05rem', fontWeight: '700' }}
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="spinner" size={20} />
                    正在合并输出中...
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    ⚡ 一键替换填充并生成 Word 
                  </>
                )}
              </button>
              
              <div className="guide-banner" style={{ marginTop: '1rem', backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' }}>
                <Sparkles className="guide-icon" style={{ color: '#16a34a' }} size={16} />
                <div className="guide-content">
                  <p style={{ color: '#15803d', fontSize: '0.75rem', lineHeight: '1.4' }}>
                    <strong>桌面版特权：</strong>文件将直接以 Word 原生独立文件，一次性瞬间写入您的本地硬盘导出目录中，彻底免去手动下载及 Zip 解压操作！
                  </p>
                </div>
              </div>

              <div style={{ marginTop: '2.5rem', display: 'flex', justifyContent: 'flex-start' }}>
                <button 
                  className="btn btn-secondary"
                  onClick={() => setCurrentStep(2)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}
                >
                  <ArrowLeft size={16} /> 上一步 调整模板配置
                </button>
              </div>
            </div>
          </section>

        </main>
      )}

      {/* ======================================================== */}
      {/* 📁 路径配置弹窗 (Modal) */}
      {/* ======================================================== */}
      {showPathModal && (
        <div className="modal-overlay">
          <div className="modal-container">
            
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FolderOpen size={20} style={{ color: 'var(--primary)' }} />
                <h3 className="modal-title">本地存储与导出路径配置</h3>
              </div>
              <button className="modal-close-btn" onClick={() => setShowPathModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                如果您运行的是 **Windows 桌面程序 (.exe)**，您可以在下方直接选择您电脑中真实的本地目录。导入的模板和生成的文件将会直接读取与写入该目录下。
              </p>

              {/* 1. 模板存放目录 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-main)' }}>📁 模板文件存放备份目录：</label>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleSelectFolder('template')}>
                    修改路径
                  </button>
                </div>
                <input 
                  type="text" 
                  className="input-field" 
                  value={templateDir} 
                  onChange={(e) => setTemplateDir(e.target.value)} 
                  style={{ background: '#f8fafc', color: 'var(--text-secondary)' }}
                />
              </div>

              {/* 2. 生成输出目录 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-main)' }}>📂 一键生成 Word 导出目录：</label>
                  <button className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => handleSelectFolder('output')}>
                    修改路径
                  </button>
                </div>
                <input 
                  type="text" 
                  className="input-field" 
                  value={outputDir} 
                  onChange={(e) => setOutputDir(e.target.value)} 
                  style={{ background: '#f8fafc', color: 'var(--text-secondary)' }}
                />
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => setShowPathModal(false)}>
                确定保存
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 属性映射配置弹窗 (Modal) */}
      {/* ======================================================== */}
      {activeTemplateId && activeTemplate && (
        <div className="modal-overlay">
          <div className="modal-container">
            
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Bookmark size={20} style={{ color: 'var(--primary)' }} />
                <h3 className="modal-title">步骤 02：当前项目字段绑定</h3>
              </div>
              <button className="modal-close-btn" onClick={() => setActiveTemplateId(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div style={{ marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>项目: </span>
                <strong style={{ fontSize: '0.9rem', color: 'var(--primary)', marginRight: '1rem' }}>{activeProject?.name || '无项目'}</strong>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>文档: </span>
                <strong style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{activeTemplate.fileName}</strong>
              </div>

              {activeTemplatePromptsCount === 0 ? (
                <div className="guide-banner" style={{ margin: 0 }}>
                  <HelpCircle className="guide-icon" size={18} />
                  <div className="guide-content">
                    <h4>未提取到任何标记</h4>
                    <p>文档中没有黄色高亮，也没有手打的 `***` 星号连打。请打开 Word 软件修改您的模板后重新上传。</p>
                  </div>
                </div>
              ) : (
                <div className="mapping-grid">
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-secondary)', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ flex: 1.2 }}>Word 模板占位提示词</span>
                    <span style={{ width: '16px' }}></span>
                    <span style={{ flex: 1.5 }}>对应当前项目的字段编号</span>
                  </div>

                  {/* 高亮标记字段 */}
                  {activeTemplate.highlights && activeTemplate.highlights.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#854d0e', marginTop: '0.5rem' }}>🔥 格式高亮区域 ({activeTemplate.highlights.length}处)</div>
                      
                      {activeTemplate.highlights.map(hl => {
                        const projectMappings = activeProject?.mappings || {};
                        const tplMappings = projectMappings[activeTemplate.id] || {};
                        const selectedDataId = tplMappings[hl] || '';
                        
                        const isAutoMatched = selectedDataId !== '' && findBestMatch(hl, activeProjectDataList) === selectedDataId;
                        
                        return (
                          <div className="mapping-item" key={hl} style={{ borderLeft: '3px solid #ca8a04' }}>
                            <div className="mapping-source">
                              <span className="highlight-tag" title={hl}>{hl}</span>
                            </div>
                            <div className="mapping-arrow">→</div>
                            <div className="mapping-target" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <select 
                                className="select-field"
                                value={selectedDataId}
                                onChange={(e) => handleMappingChange(activeTemplate.id, hl, e.target.value)}
                              >
                                <option value="">-- 原样保留 (不替换) --</option>
                                {activeProjectDataList.map((item, idx) => (
                                  <option key={item.id} value={item.id}>
                                    {idx + 1} - {item.label || '未命名'} {item.value ? `(${item.value.substring(0, 10)}${item.value.length > 10 ? '...' : ''})` : ''}
                                  </option>
                                ))}
                              </select>
                              {isAutoMatched && (
                                <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                                  <Sparkles size={9} /> 智能推荐
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 星号标记字段 */}
                  {activeTemplate.stars && activeTemplate.stars.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e3a8a', marginTop: '0.75rem' }}>✨ 星号占位符号 ({activeTemplate.stars.length}处)</div>
                      
                      {activeTemplate.stars.map(st => {
                        const projectMappings = activeProject?.mappings || {};
                        const tplMappings = projectMappings[activeTemplate.id] || {};
                        const selectedDataId = tplMappings[st] || '';
                        
                        const isAutoMatched = selectedDataId !== '' && findBestMatch(st, activeProjectDataList) === selectedDataId;
                        
                        return (
                          <div className="mapping-item" key={st} style={{ borderLeft: '3px solid var(--primary)' }}>
                            <div className="mapping-source">
                              <span className="highlight-tag" title={st} style={{ backgroundColor: '#eff6ff', color: '#1e40af', borderColor: '#bfdbfe' }}>
                                {st}
                              </span>
                            </div>
                            <div className="mapping-arrow">→</div>
                            <div className="mapping-target" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <select 
                                className="select-field"
                                value={selectedDataId}
                                onChange={(e) => handleMappingChange(activeTemplate.id, st, e.target.value)}
                              >
                                <option value="">-- 原样保留 (不替换) --</option>
                                {activeProjectDataList.map((item, idx) => (
                                  <option key={item.id} value={item.id}>
                                    {idx + 1} - {item.label || '未命名'} {item.value ? `(${item.value.substring(0, 10)}${item.value.length > 10 ? '...' : ''})` : ''}
                                  </option>
                                ))}
                              </select>
                              {isAutoMatched && (
                                <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                                  <Sparkles size={9} /> 智能推荐
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              )}
            </div>

            <div className="modal-footer">
              <button 
                className="btn btn-secondary" 
                onClick={handleAutoMatchInPopup}
              >
                <Sparkles size={14} /> 一键智能匹配当前项目字段
              </button>
              <button className="btn btn-primary" onClick={() => setActiveTemplateId(null)}>
                保存映射
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 帮助说明 */}
      <footer className="glass-card" style={{ marginTop: '1.5rem', backgroundColor: 'rgba(255, 255, 255, 0.5)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <HelpCircle size={18} style={{ color: 'var(--primary)' }} />
          如何制作 Word 模板标记？
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          <div>
            <strong style={{ color: 'var(--text-main)' }}>1. 方式 A：Word 软件内的黄色高亮涂色</strong>
            <p>用鼠标在 Word 里选中需要填写的文字，点击顶部的“高亮画笔（文本突出显示颜色）”并涂为黄色。例如把原来的“张三”涂为黄色，系统将自动擦除底色填入数据。</p>
          </div>
          <div>
            <strong style={{ color: 'var(--text-main)' }}>2. 方式 B：手打星号占位符字符 (***)</strong>
            <p>在需要填空的地方，直接键盘打字输入 `***` 或者是 `***姓名***`。如果填入的实际字数比原本星号少，系统会自动在右侧以 `*` 补足，完美维持原文档长度！</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

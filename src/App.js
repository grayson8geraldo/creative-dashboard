import React, { useState, useEffect, useMemo, useCallback } from 'react';
// ИСПРАВЛЕНО: Удалена неиспользуемая иконка 'Target'
import { Play, Pause, Eye, Users, Filter, Search, RefreshCw, BarChart3, AlertCircle, Settings, Save, X } from 'lucide-react';

function App() {
  // Состояния для фильтров
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [performanceFilter, setPerformanceFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');

  // Основные состояния приложения
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [showConfig, setShowConfig] = useState(false);

  // Состояние конфигурации
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('dashboardConfig');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      SnellCoin: { name: 'SnellCoin', emoji: '🪙', url: '', gid: '0' },
      EarnTube: { name: 'EarnTube', emoji: '📺', url: '', gid: '' }
    };
  });

  const [tempConfig, setTempConfig] = useState(config);

  const isConfigured = useMemo(() => {
    return Object.values(config).every(project => project.url && project.gid !== '');
  }, [config]);

  const GOOGLE_SHEETS_URLS = useMemo(() => {
    const urls = {};
    Object.entries(config).forEach(([key, project]) => {
      if (project.url && project.gid !== '') {
        urls[key] = `${project.url}/export?format=csv&gid=${project.gid}`;
      }
    });
    return urls;
  }, [config]);
  
  const saveConfig = () => {
    setConfig(tempConfig);
    localStorage.setItem('dashboardConfig', JSON.stringify(tempConfig));
    setShowConfig(false);
    setTimeout(() => loadData(), 100); 
  };

  const resetConfig = () => {
    setTempConfig(config);
    setShowConfig(false);
  };
  
  // ДОБАВЛЕНО: Функционал для добавления и удаления проектов в настройках
  const addProject = () => {
    const newProjectKey = `project_${Date.now()}`;
    setTempConfig(prev => ({
      ...prev,
      [newProjectKey]: { name: 'New Project', emoji: '🆕', url: '', gid: '' }
    }));
  };

  const removeProject = (projectKeyToRemove) => {
    if (Object.keys(tempConfig).length <= 1) {
      alert("You cannot remove the last project.");
      return;
    }
    setTempConfig(prev => {
      const newConfig = { ...prev };
      delete newConfig[projectKeyToRemove];
      return newConfig;
    });
  };

  const handleUrlChange = (project, value) => {
    let processedUrl = value;
    const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      processedUrl = `https://docs.google.com/spreadsheets/d/${match[1]}`;
    } else if (value && !value.includes('docs.google.com') && value.length > 20) {
      processedUrl = `https://docs.google.com/spreadsheets/d/${value}`;
    }
    setTempConfig(prev => ({
      ...prev,
      [project]: { ...prev[project], url: processedUrl }
    }));
  };

  const loadSheetData = async (project, url) => {
    const response = await fetch(url + '&timestamp=' + Date.now());
    if (!response.ok) {
        let errorMessage = `HTTP ошибка для ${project}: ${response.status}`;
        if (response.status === 403) errorMessage = `Доступ к таблице ${project} запрещен. Убедитесь, что она опубликована для чтения.`;
        if (response.status === 404) errorMessage = `Таблица ${project} не найдена. Проверьте ID таблицы и GID листа.`;
        throw new Error(errorMessage);
    }
    const csvData = await response.text();
    if (!csvData || csvData.trim().startsWith("<!DOCTYPE html>")) {
      throw new Error(`Получены неверные данные для ${project} (вероятно, страница входа Google)`);
    }
    return csvData;
  };

  const processSheetData = (csvData, project) => {
    const rows = csvData.split('\n');
    const headers = rows[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = rows.slice(1).map(rowStr => {
      const values = rowStr.split(',');
      const row = {};
      headers.forEach((header, index) => {
        let value = values[index] ? values[index].trim().replace(/"/g, '') : '';
        row[header] = header.includes('Users_') ? parseInt(value) || 0 : value;
      });
      return row;
    }).filter(row => row.Date);

    const accountColumns = headers.filter(h => h.startsWith('Account_')).length;
    if (accountColumns === 0) throw new Error(`Не найдены колонки аккаунтов (Account_X) для проекта ${project}`);

    const creativeHistory = {};
    const accounts = new Set();
    data.forEach(row => {
      for (let i = 1; i <= accountColumns; i++) {
        const account = row[`Account_${i}`];
        const creative = row[`Creative_${i}`];
        const users = row[`Users_${i}`] || 0;
        if (account && creative) {
          accounts.add(account);
          if (!creativeHistory[creative]) {
            creativeHistory[creative] = { totalUsers: 0, accounts: new Set(), history: [], project };
          }
          creativeHistory[creative].totalUsers += users;
          creativeHistory[creative].accounts.add(account);
          creativeHistory[creative].history.push({ date: row.Date, account, users });
        }
      }
    });

    Object.values(creativeHistory).forEach(ch => {
      const uniqueDates = new Set(ch.history.map(h => h.date));
      ch.daysActive = uniqueDates.size;
      ch.avgUsersPerDay = ch.daysActive > 0 ? Math.round(ch.totalUsers / ch.daysActive * 10) / 10 : 0;
    });

    const latestDate = data.length > 0 ? data[data.length - 1].Date : null;
    const lastDateRow = data.find(row => row.Date === latestDate);
    const activeCreativesOnLastDate = [];
    if (lastDateRow) {
      for (let i = 1; i <= accountColumns; i++) {
        const creative = lastDateRow[`Creative_${i}`];
        if (creative) {
          activeCreativesOnLastDate.push({
            creative,
            account: lastDateRow[`Account_${i}`],
            users: lastDateRow[`Users_${i}`] || 0,
            project
          });
        }
      }
    }

    return { latestDate, creativeHistory, accounts: [...accounts], activeCreativesOnLastDate, accountColumns };
  };
  
  const loadData = useCallback(async () => {
    if (!isConfigured) return;

    setLoading(true);
    setError(null);
    try {
      const projectDataEntries = await Promise.all(
        Object.entries(GOOGLE_SHEETS_URLS).map(async ([project, url]) => {
          const csvData = await loadSheetData(project, url);
          return [project, processSheetData(csvData, project)];
        })
      );
      const processedProjects = Object.fromEntries(projectDataEntries);

      const allCreativeHistory = Object.values(processedProjects).reduce((acc, p) => ({ ...acc, ...p.creativeHistory }), {});
      const allUniqueCreatives = Object.keys(allCreativeHistory);
      const allAccounts = [...new Set(Object.values(processedProjects).flatMap(p => p.accounts))];
      const allActiveCreatives = Object.values(processedProjects).flatMap(p => p.activeCreativesOnLastDate);
      const combinedLatestDate = Object.values(processedProjects).map(p => p.latestDate).filter(Boolean).sort().reverse()[0];

      const creativeAnalytics = allUniqueCreatives.map(creativeName => {
        const history = allCreativeHistory[creativeName];
        const activeInstances = allActiveCreatives.filter(c => c.creative === creativeName);
        const isActive = activeInstances.length > 0;
        const currentUsers = isActive ? activeInstances.reduce((sum, item) => sum + item.users, 0) : 0;
        
        let performance = 'medium';
        if (history.totalUsers > 200) performance = 'high';
        else if (history.totalUsers <= 50 && history.accounts.size > 3 && history.avgUsersPerDay < 2) performance = 'low';

        return {
          id: creativeName.replace(/[^a-zA-Z0-9]/g, '_'),
          creative: creativeName,
          status: isActive ? 'active' : 'free',
          totalUsers: history.totalUsers,
          currentUsers,
          daysActive: history.daysActive,
          accounts: [...history.accounts],
          currentAccounts: activeInstances,
          avgUsersPerDay: history.avgUsersPerDay,
          performance,
          project: history.project
        };
      }).sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        if (a.status === 'active') return b.currentUsers - a.currentUsers;
        return b.totalUsers - a.totalUsers;
      });

      const projectStats = {};
      Object.keys(processedProjects).forEach(projectKey => {
        projectStats[projectKey] = {
          totalCreatives: creativeAnalytics.filter(c => c.project === projectKey).length,
          activeCreatives: creativeAnalytics.filter(c => c.status === 'active' && c.project === projectKey).length,
          totalUsers: creativeAnalytics.filter(c => c.project === projectKey).reduce((sum, c) => sum + c.totalUsers, 0),
          currentUsers: allActiveCreatives.filter(item => item.project === projectKey).reduce((sum, item) => sum + item.users, 0),
          totalAccounts: processedProjects[projectKey].accounts.length
        };
      });

      const activeCount = creativeAnalytics.filter(c => c.status === 'active').length;

      setDashboardData({
        latestDate: combinedLatestDate,
        creativeAnalytics,
        allAccounts,
        projectStats,
        summary: {
          totalCreatives: allUniqueCreatives.length,
          activeCreatives: activeCount,
          freeCreatives: allUniqueCreatives.length - activeCount,
          totalAccounts: allAccounts.length,
          accountColumns: Object.values(processedProjects).reduce((sum, p) => sum + p.accountColumns, 0),
          totalUsersAllTime: creativeAnalytics.reduce((sum, c) => sum + c.totalUsers, 0),
          totalCurrentUsers: creativeAnalytics.reduce((sum, c) => sum + c.currentUsers, 0),
        }
      });
      setLastUpdate(new Date().toLocaleString('ru-RU'));
    } catch (err) {
      console.error('❌ Критическая ошибка загрузки:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isConfigured, GOOGLE_SHEETS_URLS]);

  useEffect(() => {
    if (isConfigured) {
      loadData();
      const interval = setInterval(loadData, 5 * 60 * 1000); // Обновление каждые 5 минут
      return () => clearInterval(interval);
    }
  }, [isConfigured, loadData]);

  const filteredCreatives = useMemo(() => {
    if (!dashboardData) return [];
    
    return dashboardData.creativeAnalytics.filter(creative => {
      const matchesSearch = creative.creative.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            creative.accounts.some(account => account.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesStatus = statusFilter === 'all' || creative.status === statusFilter;
      const matchesAccount = accountFilter === 'all' || 
                             creative.accounts.includes(accountFilter) ||
                             creative.currentAccounts.some(acc => acc.account === accountFilter);
      const matchesPerformance = performanceFilter === 'all' || creative.performance === performanceFilter;
      const matchesProject = projectFilter === 'all' || creative.project === projectFilter;
      
      return matchesSearch && matchesStatus && matchesAccount && matchesPerformance && matchesProject;
    });
  }, [dashboardData, searchTerm, statusFilter, accountFilter, performanceFilter, projectFilter]);

  if (!isConfigured && !showConfig) {
    return (
      <div style={{minHeight: '100vh', background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{backgroundColor: '#374151', padding: '32px', borderRadius: '12px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', maxWidth: '672px', width: '100%', margin: '0 16px'}}>
          <div style={{textAlign: 'center', marginBottom: '32px'}}>
            <Settings style={{width: '64px', height: '64px', color: '#60a5fa', margin: '0 auto 16px auto'}} />
            <h1 style={{fontSize: '30px', fontWeight: 'bold', marginBottom: '8px'}}>Добро пожаловать в Multi-Project Dashboard</h1>
            <p style={{color: '#9ca3af'}}>Настройте ваши Google Таблицы для начала работы</p>
          </div>
          <div style={{marginBottom: '24px'}}>
            <div style={{backgroundColor: 'rgba(30, 58, 138, 0.3)', padding: '16px', borderRadius: '8px', border: '1px solid #2563eb', marginBottom: '24px'}}>
              <h3 style={{fontWeight: '600', marginBottom: '8px'}}>📋 Инструкция по настройке:</h3>
              <ol style={{fontSize: '14px', color: '#d1d5db', lineHeight: '1.5', paddingLeft: '16px'}}>
                <li>1. Откройте вашу Google Таблицу с данными креативов</li>
                <li>2. Сделайте её публично доступной (Доступ по ссылке)</li>
                <li>3. Скопируйте URL таблицы и найдите GID каждой вкладки</li>
                <li>4. Настройте ваши проекты ниже</li>
              </ol>
            </div>
            <button onClick={() => setShowConfig(true)} style={{width: '100%', backgroundColor: '#2563eb', color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}>
              <Settings style={{width: '16px', height: '16px'}} />
              Настроить Google Таблицы
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !dashboardData) {
    return (
      <div style={{minHeight: '100vh', background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{textAlign: 'center'}}>
          <RefreshCw style={{width: '48px', height: '48px', color: '#60a5fa', margin: '0 auto 16px auto', animation: 'spin 1s linear infinite'}} />
          <p style={{fontSize: '20px'}}>Загрузка данных из Google Таблиц...</p>
          <p style={{fontSize: '14px', color: '#9ca3af', marginTop: '8px'}}>Подключение к настроенным таблицам</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{minHeight: '100vh', background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{backgroundColor: '#374151', padding: '32px', borderRadius: '12px', textAlign: 'center', maxWidth: '500px', width: '100%'}}>
          <AlertCircle style={{width: '64px', height: '64px', color: '#f87171', margin: '0 auto 16px auto'}} />
          <p style={{fontSize: '20px', color: '#f87171', fontWeight: 'bold'}}>Ошибка подключения</p>
          <p style={{color: '#e5e7eb', backgroundColor: '#4b5563', padding: '12px', borderRadius: '8px', marginTop: '8px', marginBottom: '24px', fontFamily: 'monospace', fontSize: '14px', textAlign: 'left'}}>{error}</p>
          <div style={{display: 'flex', gap: '16px', justifyContent: 'center'}}>
            <button onClick={loadData} style={{backgroundColor: '#2563eb', color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'}}>
              <RefreshCw style={{width: '16px', height: '16px'}} />
              Попробовать снова
            </button>
            <button onClick={() => { setError(null); setShowConfig(true); }} style={{backgroundColor: '#4b5563', color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'}}>
              <Settings style={{width: '16px', height: '16px'}} />
              Настроить
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight: '100vh', background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)', color: 'white', padding: '24px'}}>
      {showConfig && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px'}}>
          <div style={{backgroundColor: '#374151', borderRadius: '12px', padding: '24px', maxWidth: '896px', width: '100%', maxHeight: '90vh', overflowY: 'auto'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px'}}>
              <h2 style={{fontSize: '24px', fontWeight: 'bold'}}>Настройка проектов</h2>
              <button onClick={resetConfig} style={{background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer'}}>
                <X style={{width: '24px', height: '24px'}} />
              </button>
            </div>
            <div style={{marginBottom: '24px'}}>
              {Object.entries(tempConfig).map(([projectKey, project]) => (
                <div key={projectKey} style={{backgroundColor: '#4b5563', padding: '16px', borderRadius: '8px', marginBottom: '16px', position: 'relative'}}>
                   <button onClick={() => removeProject(projectKey)} style={{position: 'absolute', top: '12px', right: '12px', background: '#6b7280', border: 'none', color: '#e5e7eb', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={16} />
                  </button>
                  <div style={{display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px'}}>
                    <input type="text" placeholder="😀" style={{backgroundColor: '#6b7280', color: 'white', padding: '8px', borderRadius: '4px', border: 'none', fontWeight: '600', width: '40px', textAlign: 'center', fontSize: '20px'}} value={project.emoji} onChange={(e) => setTempConfig(prev => ({...prev, [projectKey]: {...prev[projectKey], emoji: e.target.value}}))} />
                    <input type="text" placeholder="Название проекта" style={{backgroundColor: '#6b7280', color: 'white', padding: '8px 12px', borderRadius: '4px', border: 'none', fontWeight: '600', flex: 1}} value={project.name} onChange={(e) => setTempConfig(prev => ({...prev, [projectKey]: {...prev[projectKey], name: e.target.value}}))} />
                  </div>
                  <div style={{marginBottom: '12px'}}>
                    <label style={{display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px'}}>URL Google Таблицы или ID:</label>
                    <input type="text" placeholder="https://docs.google.com/spreadsheets/d/..." style={{width: '100%', backgroundColor: '#6b7280', color: 'white', padding: '8px 12px', borderRadius: '4px', border: 'none', boxSizing: 'border-box'}} value={project.url} onChange={(e) => handleUrlChange(projectKey, e.target.value)} />
                  </div>
                  <div>
                    <label style={{display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px'}}>GID вкладки:</label>
                    <input type="text" placeholder="0" style={{width: '100%', backgroundColor: '#6b7280', color: 'white', padding: '8px 12px', borderRadius: '4px', border: 'none', boxSizing: 'border-box'}} value={project.gid} onChange={(e) => setTempConfig(prev => ({...prev, [projectKey]: {...prev[projectKey], gid: e.target.value}}))} />
                  </div>
                </div>
              ))}
              <button onClick={addProject} style={{width: '100%', backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#22c55e', padding: '10px', borderRadius: '8px', border: '1px dashed #22c55e', cursor: 'pointer'}}>+ Добавить проект</button>
            </div>
            <div style={{display: 'flex', gap: '16px'}}>
              <button onClick={saveConfig} style={{flex: 1, backgroundColor: '#2563eb', color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}>
                <Save style={{width: '16px', height: '16px'}} />
                Сохранить и перезагрузить
              </button>
              <button onClick={resetConfig} style={{padding: '12px 24px', backgroundColor: '#6b7280', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer'}}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {dashboardData && !showConfig && (
        <>
          {/* Header */}
          <div style={{ marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
              <div>
                <h1 style={{ fontSize: '36px', fontWeight: 'bold', background: 'linear-gradient(to right, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                  Multi-Project Creative Analytics
                </h1>
                <p style={{ color: '#9ca3af', marginTop: '8px' }}>
                  📅 Последняя дата: <span style={{ fontWeight: '600', color: 'white' }}>{dashboardData.latestDate}</span> | 📊 {dashboardData.summary.totalCreatives} креативов | 🏢 {dashboardData.summary.totalAccounts} аккаунтов
                </p>
                {lastUpdate && <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>🔄 Последнее обновление: {lastUpdate}</p>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button onClick={() => setShowConfig(true)} style={{ backgroundColor: '#4b5563', color: 'white', padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Settings style={{ width: '16px', height: '16px' }} />
                  Настройки
                </button>
                <button onClick={loadData} disabled={loading} style={{ backgroundColor: loading ? '#6b7280' : '#2563eb', color: 'white', padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw style={{ width: '16px', height: '16px', animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                  Обновить
                </button>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
            <div style={{ background: 'linear-gradient(to right, #059669, #047857)', padding: '24px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px' }}>🟢 Активные</p>
                  <p style={{ fontSize: '30px', fontWeight: 'bold' }}>{dashboardData.summary.activeCreatives}</p>
                </div>
                <Play style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
            <div style={{ background: 'linear-gradient(to right, #6b7280, #4b5563)', padding: '24px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px' }}>⚪ Свободные</p>
                  <p style={{ fontSize: '30px', fontWeight: 'bold' }}>{dashboardData.summary.freeCreatives}</p>
                </div>
                <Pause style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
            <div style={{ background: 'linear-gradient(to right, #2563eb, #1d4ed8)', padding: '24px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px' }}>👥 Пользователей сегодня</p>
                  <p style={{ fontSize: '30px', fontWeight: 'bold' }}>{dashboardData.summary.totalCurrentUsers.toLocaleString()}</p>
                </div>
                <Users style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
            <div style={{ background: 'linear-gradient(to right, #7c3aed, #6d28d9)', padding: '24px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px' }}>📈 Пользователей всего</p>
                  <p style={{ fontSize: '30px', fontWeight: 'bold' }}>{dashboardData.summary.totalUsersAllTime.toLocaleString()}</p>
                </div>
                <BarChart3 style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
          </div>
          
          {/* Filters */}
          <div style={{ backgroundColor: '#374151', padding: '24px', borderRadius: '12px', marginBottom: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <Search style={{ position: 'absolute', left: '12px', top: '12px', width: '20px', height: '20px', color: '#9ca3af' }} />
                <input type="text" placeholder="Поиск по креативу или аккаунту..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: '100%', backgroundColor: '#4b5563', color: 'white', paddingLeft: '40px', paddingRight: '16px', paddingTop: '12px', paddingBottom: '12px', borderRadius: '8px', border: 'none', boxSizing: 'border-box' }}/>
              </div>
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{ backgroundColor: '#4b5563', color: 'white', padding: '12px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}>
                <option value="all">🎯 Все проекты</option>
                {Object.entries(config).map(([key, proj]) => <option key={key} value={key}>{proj.emoji} {proj.name}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ backgroundColor: '#4b5563', color: 'white', padding: '12px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}>
                <option value="all">📋 Все статусы</option>
                <option value="active">🟢 Активные</option>
                <option value="free">⚪ Свободные</option>
              </select>
              <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} style={{ backgroundColor: '#4b5563', color: 'white', padding: '12px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}>
                <option value="all">🏢 Все аккаунты</option>
                {dashboardData.allAccounts.map(acc => <option key={acc} value={acc}>{acc}</option>)}
              </select>
              <select value={performanceFilter} onChange={(e) => setPerformanceFilter(e.target.value)} style={{ backgroundColor: '#4b5563', color: 'white', padding: '12px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}>
                <option value="all">📊 Вся производительность</option>
                <option value="high">🔥 Высокая</option>
                <option value="medium">📈 Средняя</option>
                <option value="low">📉 Низкая</option>
              </select>
              <div style={{backgroundColor: '#4b5563', padding: '12px 16px', borderRadius: '8px', color: '#d1d5db', fontSize: '14px', display: 'flex', alignItems: 'center' }}>
                  <Filter style={{ width: '16px', height: '16px', marginRight: '8px' }} />
                  Найдено: {filteredCreatives.length}
              </div>
            </div>
          </div>

          {/* Table */}
          <div style={{ backgroundColor: '#374151', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ backgroundColor: '#4b5563' }}>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Статус</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Проект</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Креатив</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Польз. сейчас</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Польз. всего</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Текущие аккаунты</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Дней активно</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Сред./день</th>
                    <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Performance</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCreatives.map((creative, index) => (
                    <tr key={creative.id} style={{ borderTop: '1px solid #4b5563', backgroundColor: index % 2 === 0 ? '#374151' : '#475569' }}>
                      <td style={{ padding: '16px' }}>
                        <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: creative.status === 'active' ? '#065f46' : '#4b5563', color: creative.status === 'active' ? '#10b981' : '#d1d5db' }}>
                          {creative.status === 'active' ? <Play size={12}/> : <Pause size={12}/>}
                          {creative.status === 'active' ? 'Активен' : 'Свободен'}
                        </span>
                      </td>
                      <td style={{ padding: '16px' }}>{config[creative.project]?.emoji} {config[creative.project]?.name}</td>
                      <td style={{ padding: '16px', fontFamily: 'monospace' }}>{creative.creative}</td>
                      <td style={{ padding: '16px', fontWeight: 'bold', color: creative.currentUsers > 0 ? '#60a5fa' : '#9ca3af' }}>{creative.currentUsers}</td>
                      <td style={{ padding: '16px' }}>{creative.totalUsers}</td>
                      <td style={{ padding: '16px', fontSize: '12px' }}>{creative.currentAccounts.map(ca => ca.account).join(', ')}</td>
                      <td style={{ padding: '16px' }}>{creative.daysActive}</td>
                      <td style={{ padding: '16px' }}>{creative.avgUsersPerDay}</td>
                      <td style={{ padding: '16px' }}>
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '20px',
                          fontSize: '14px',
                          fontWeight: '500',
                          backgroundColor: creative.performance === 'high' ? '#065f46' : creative.performance === 'medium' ? '#92400e' : '#7f1d1d',
                          color: creative.performance === 'high' ? '#10b981' : creative.performance === 'medium' ? '#fbbf24' : '#f87171'
                        }}>
                           {creative.performance === 'high' ? '🔥 High' : creative.performance === 'medium' ? '📈 Medium' : '📉 Low'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
             {filteredCreatives.length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px 0', color: '#9ca3af' }}>
                    <Eye style={{ width: '48px', height: '48px', margin: '0 auto 16px auto', color: '#6b7280' }}/>
                    <p style={{fontSize: '18px'}}>Креативы не найдены</p>
                    <p style={{fontSize: '14px', color: '#6b7280'}}>Попробуйте изменить фильтры поиска</p>
                </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
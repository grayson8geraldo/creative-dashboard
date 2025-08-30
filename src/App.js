import React, { useState, useEffect, useMemo, useCallback } from 'react'; // 1. Import useCallback
import { Play, Pause, Eye, Users, Target, Filter, Search, RefreshCw, BarChart3, AlertCircle, Settings, Save, X } from 'lucide-react';

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [performanceFilter, setPerformanceFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');

  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [showConfig, setShowConfig] = useState(false);

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
  };

  const resetConfig = () => {
    setTempConfig(config);
    setShowConfig(false);
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
    if (!response.ok) throw new Error(`HTTP error for ${project}: ${response.status}`);
    const csvData = await response.text();
    if (!csvData || csvData.trim().startsWith("<!DOCTYPE html>")) {
      throw new Error(`Received invalid data for ${project} (likely HTML page)`);
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
    if (accountColumns === 0) throw new Error(`No account columns found for ${project}`);

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

    const latestDate = data[data.length - 1]?.Date;
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

  // 2. Wrap loadData in useCallback
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
      console.error('❌ Critical loading error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isConfigured, GOOGLE_SHEETS_URLS]); // Dependencies for useCallback

  // 3. Add 'loadData' to the dependency array
  useEffect(() => {
    if (isConfigured) {
      loadData();
      const interval = setInterval(loadData, 12 * 60 * 60 * 1000); // 12 hours
      return () => clearInterval(interval);
    }
  }, [isConfigured, loadData]);

  const filteredCreatives = useMemo(() => {
    if (!dashboardData) return [];
    return dashboardData.creativeAnalytics.filter(c => 
      (c.creative.toLowerCase().includes(searchTerm.toLowerCase()) || c.accounts.some(acc => acc.toLowerCase().includes(searchTerm.toLowerCase()))) &&
      (statusFilter === 'all' || c.status === statusFilter) &&
      (accountFilter === 'all' || c.accounts.includes(accountFilter) || c.currentAccounts.some(acc => acc.account === accountFilter)) &&
      (performanceFilter === 'all' || c.performance === performanceFilter) &&
      (projectFilter === 'all' || c.project === projectFilter)
    );
  }, [dashboardData, searchTerm, statusFilter, accountFilter, performanceFilter, projectFilter]);
  
  // --- RENDER LOGIC ---
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
              <div style={{marginTop: '12px', padding: '12px', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderRadius: '6px', border: '1px solid #22c55e'}}>
                <p style={{fontSize: '14px', color: '#22c55e', marginBottom: '8px', fontWeight: '500'}}>📖 Подробная инструкция:</p>
                <a href="https://docs.google.com/document/d/19d3df8PlQHD735yJjiVV9HhPWxP71NKnzIN84dn8LSg/edit?usp=sharing" target="_blank" rel="noopener noreferrer" style={{color: '#22c55e', fontSize: '14px', textDecoration: 'underline'}}>Открыть полное руководство по настройке →</a>
              </div>
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
        <div style={{textAlign: 'center'}}>
          <AlertCircle style={{width: '64px', height: '64px', color: '#f87171', margin: '0 auto 16px auto'}} />
          <p style={{fontSize: '20px', color: '#f87171'}}>Ошибка подключения</p>
          <p style={{color: '#9ca3af', marginBottom: '16px'}}>{error}</p>
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

  if (!dashboardData) return null;

  const stats = dashboardData.summary;

  return (
    <div style={{minHeight: '100vh', background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)', color: 'white', padding: '24px'}}>
      {showConfig && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px'}}>
          <div style={{backgroundColor: '#374151', borderRadius: '12px', padding: '24px', maxWidth: '896px', width: '100%', maxHeight: '90vh', overflowY: 'auto'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px'}}>
              <h2 style={{fontSize: '24px', fontWeight: 'bold'}}>Настройка Google Таблиц</h2>
              <button onClick={resetConfig} style={{background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer'}}>
                <X style={{width: '24px', height: '24px'}} />
              </button>
            </div>
            <div style={{marginBottom: '24px'}}>
              {Object.entries(tempConfig).map(([projectKey, project]) => (
                <div key={projectKey} style={{backgroundColor: '#4b5563', padding: '16px', borderRadius: '8px', marginBottom: '24px'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px'}}>
                    <span style={{fontSize: '24px'}}>{project.emoji}</span>
                    <input type="text" placeholder="Название проекта" style={{backgroundColor: '#6b7280', color: 'white', padding: '8px 12px', borderRadius: '4px', border: 'none', fontWeight: '600'}} value={project.name} onChange={(e) => setTempConfig(prev => ({...prev, [projectKey]: {...prev[projectKey], name: e.target.value}}))} />
                  </div>
                  <div style={{marginBottom: '12px'}}>
                    <label style={{display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px'}}>URL Google Таблицы или ID таблицы:</label>
                    <input type="text" placeholder="https://docs.google.com/spreadsheets/d/ВАШ_ID_ТАБЛИЦЫ или только ID" style={{width: '100%', backgroundColor: '#6b7280', color: 'white', padding: '8px 12px', borderRadius: '4px', border: 'none', boxSizing: 'border-box'}} value={project.url} onChange={(e) => handleUrlChange(projectKey, e.target.value)} />
                    <p style={{fontSize: '12px', color: '#9ca3af', marginTop: '4px'}}>Вставьте полный URL или только ID таблицы</p>
                  </div>
                  <div>
                    <label style={{display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px'}}>GID вкладки (ID вкладки):</label>
                    <input type="text" placeholder="0 (для первой вкладки) или конкретный GID" style={{width: '100%', backgroundColor: '#6b7280', color: 'white', padding: '8px 12px', borderRadius: '4px', border: 'none', boxSizing: 'border-box'}} value={project.gid} onChange={(e) => setTempConfig(prev => ({...prev, [projectKey]: {...prev[projectKey], gid: e.target.value}}))} />
                    <p style={{fontSize: '12px', color: '#9ca3af', marginTop: '4px'}}>Найдите в URL при просмотре конкретной вкладки: #gid=123456789</p>
                  </div>
                </div>
              ))}
            </div>
            <div style={{display: 'flex', gap: '16px'}}>
              <button onClick={saveConfig} style={{flex: 1, backgroundColor: '#2563eb', color: 'white', padding: '12px 24px', borderRadius: '8px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}>
                <Save style={{width: '16px', height: '16px'}} />
                Сохранить настройки
              </button>
              <button onClick={resetConfig} style={{padding: '12px 24px', backgroundColor: '#6b7280', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer'}}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* Main Dashboard Content */}
      <div style={{marginBottom: '32px'}}>
        {/* Header */}
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px'}}>
          {/* Left Header */}
          <div>
            <h1 style={{fontSize: '36px', fontWeight: 'bold', background: 'linear-gradient(to right, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text'}}>Multi-Project Creative Analytics Dashboard</h1>
            <div style={{display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px'}}>
              <p style={{color: '#9ca3af'}}>
                📅 Последняя дата: <span style={{fontWeight: '600', color: 'white'}}>{dashboardData.latestDate}</span> | 📊 {stats.totalCreatives} креативов | 🏢 {stats.totalAccounts} аккаунтов | 📋 {stats.accountColumns} колонок данных
              </p>
              <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                <button onClick={() => setProjectFilter('all')} style={{padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', border: 'none', cursor: 'pointer', backgroundColor: projectFilter === 'all' ? '#2563eb' : '#4b5563', color: 'white'}}>📊 Все проекты</button>
                {Object.entries(config).map(([projectKey, project]) => (
                  <button key={projectKey} onClick={() => setProjectFilter(projectKey)} style={{padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', border: 'none', cursor: 'pointer', backgroundColor: projectFilter === projectKey ? '#059669' : '#4b5563', color: 'white'}}>
                    {project.emoji} {project.name} ({dashboardData.projectStats[projectKey]?.activeCreatives || 0})
                  </button>
                ))}
              </div>
            </div>
            {lastUpdate && <p style={{fontSize: '12px', color: '#6b7280', marginTop: '4px'}}>🔄 Последнее обновление: {lastUpdate}</p>}
          </div>
          {/* Right Header */}
          <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
            <button onClick={() => setShowConfig(true)} style={{backgroundColor: '#6b7280', color: 'white', padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'}}>
              <Settings style={{width: '16px', height: '16px'}} />
              Настроить
            </button>
            <div style={{textAlign: 'right'}}>
              <div style={{fontSize: '14px', color: '#9ca3af'}}>Синхронизация с Google Таблицами</div>
              <div style={{fontSize: '18px', fontWeight: '600', color: '#10b981'}}>{loading ? 'Обновление...' : '✓ Подключено'}</div>
            </div>
            <button onClick={loadData} disabled={loading} style={{backgroundColor: loading ? '#6b7280' : '#2563eb', color: 'white', padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px'}}>
              <RefreshCw style={{width: '16px', height: '16px', animation: loading ? 'spin 1s linear infinite' : 'none'}} />
              Обновить
            </button>
          </div>
        </div>
        
        {/* Stats Cards & Filters can go here */}
      </div>

      {/* Creatives Table */}
      <div style={{backgroundColor: '#374151', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', overflow: 'hidden'}}>
        {/* Table implementation */}
      </div>
    </div>
  );
}

export default App;
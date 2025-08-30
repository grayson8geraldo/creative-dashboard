import React, { useState, useEffect, useMemo } from 'react';
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

  // Configuration state
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('dashboardConfig');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      SnellCoin: {
        name: 'SnellCoin',
        emoji: '🪙',
        url: '',
        gid: '0'
      },
      EarnTube: {
        name: 'EarnTube', 
        emoji: '📺',
        url: '',
        gid: ''
      }
    };
  });

  const [tempConfig, setTempConfig] = useState(config);

  // Check if configuration is complete
  const isConfigured = useMemo(() => {
    return Object.values(config).every(project => project.url && project.gid !== '');
  }, [config]);

  // Generate Google Sheets URLs from configuration
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

  // Auto-complete base URL when spreadsheet ID is detected
  const handleUrlChange = (project, value) => {
    let processedValue = value;
    
    // If it looks like just a spreadsheet ID, build the full URL
    if (value && !value.includes('docs.google.com') && value.length > 20) {
      processedValue = `https://docs.google.com/spreadsheets/d/${value}`;
    }
    
    setTempConfig(prev => ({
      ...prev,
      [project]: {
        ...prev[project],
        url: processedValue
      }
    }));
  };

  // Function to fetch data from a specific sheet
  const loadSheetData = async (project, url) => {
    console.log(`📊 Loading ${project} data from sheet...`);
    
    const possibleUrls = [
      url + '&timestamp=' + Date.now(),
      url.replace('/export?format=csv', '/gviz/tq?tqx=out:csv'),
      url + '&single=true&output=csv&timestamp=' + Date.now()
    ];
    
    let csvData = null;
    let lastError = null;
    
    for (let i = 0; i < possibleUrls.length; i++) {
      try {
        console.log(`${project} attempt ${i + 1}/${possibleUrls.length}: ${possibleUrls[i]}`);
        
        const response = await fetch(possibleUrls[i], {
          method: 'GET',
          headers: {
            'Accept': 'text/csv,application/csv,text/plain',
            'Cache-Control': 'no-cache'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        csvData = await response.text();
        
        if (!csvData || csvData.trim().length < 50) {
          throw new Error('Received empty or too short data');
        }
        
        console.log(`✅ ${project} data loaded successfully!`);
        console.log(`${project} data size:`, csvData.length, 'characters');
        break;
        
      } catch (error) {
        console.log(`❌ ${project} URL ${i + 1} failed:`, error.message);
        lastError = error;
        
        if (i < possibleUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    if (!csvData) {
      throw new Error(`Failed to load ${project} data from any URL. Last error: ${lastError?.message || 'unknown error'}`);
    }
    
    return csvData;
  };

  // Process individual sheet data
  const processSheetData = (csvData, project) => {
    const parsed = {
      data: [],
      meta: { fields: [] }
    };

    const rows = csvData.split('\n');
    if (rows.length < 2) throw new Error('Invalid CSV format');

    const headers = rows[0].split(',').map(h => h.trim().replace(/"/g, ''));
    parsed.meta.fields = headers;

    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].trim()) continue;
      
      const values = rows[i].split(',');
      const row = {};
      
      headers.forEach((header, index) => {
        let value = values[index] ? values[index].trim().replace(/"/g, '') : '';
        
        if (header === 'Date') {
          row[header] = value;
        } else if (header.includes('Users_')) {
          row[header] = parseInt(value) || 0;
        } else {
          row[header] = value;
        }
      });
      
      parsed.data.push(row);
    }

    console.log(`${project} - Parsed rows:`, parsed.data.length);
    console.log(`${project} - Columns:`, parsed.meta.fields?.slice(0, 10));

    const dates = parsed.data.map(row => row.Date).filter(date => date);
    const latestDate = dates[dates.length - 1];
    
    const accountColumns = parsed.meta.fields.filter(field => field.startsWith('Account_')).length;
    console.log(`${project} - Found ${accountColumns} account columns`);
    
    if (accountColumns === 0) {
      throw new Error(`No account columns found for ${project} (Account_X)`);
    }
    
    let uniqueCreatives = new Set();
    let creativeHistory = {};
    let accounts = [];
    
    parsed.data.forEach(row => {
      if (!row.Date) return;
      
      for (let i = 1; i <= accountColumns; i++) {
        const account = row[`Account_${i}`];
        const creative = row[`Creative_${i}`];
        const users = parseInt(row[`Users_${i}`]) || 0;
        
        if (account && creative && creative.trim() !== '') {
          if (!accounts.includes(account)) {
            accounts.push(account);
          }
          
          uniqueCreatives.add(creative);
          
          if (!creativeHistory[creative]) {
            creativeHistory[creative] = {
              creative: creative,
              totalUsers: 0,
              daysActive: 0,
              accounts: new Set(),
              lastActiveDate: row.Date,
              history: [],
              project: project
            };
          }
          
          creativeHistory[creative].totalUsers += users;
          creativeHistory[creative].accounts.add(account);
          creativeHistory[creative].history.push({
            date: row.Date,
            account: account,
            users: users,
            project: project
          });
        }
      }
    });

    // Calculate days active for each creative
    Object.keys(creativeHistory).forEach(creative => {
      const uniqueDates = [...new Set(creativeHistory[creative].history.map(h => h.date))];
      creativeHistory[creative].daysActive = uniqueDates.length;
      creativeHistory[creative].avgUsersPerDay = 
        creativeHistory[creative].daysActive > 0 
          ? Math.round((creativeHistory[creative].totalUsers / creativeHistory[creative].daysActive) * 10) / 10 
          : 0;
    });

    // Find active creatives on latest date
    const lastDateRow = parsed.data.find(row => row.Date === latestDate);
    let activeCreativesOnLastDate = [];
    
    if (lastDateRow) {
      for (let i = 1; i <= accountColumns; i++) {
        const account = lastDateRow[`Account_${i}`];
        const creative = lastDateRow[`Creative_${i}`];
        const users = parseInt(lastDateRow[`Users_${i}`]) || 0;
        
        if (account && creative && creative.trim() !== '') {
          activeCreativesOnLastDate.push({
            account: account,
            creative: creative,
            users: users,
            project: project
          });
        }
      }
    }

    return {
      latestDate,
      uniqueCreatives,
      creativeHistory,
      accounts,
      activeCreativesOnLastDate,
      accountColumns
    };
  };

  const loadData = async () => {
    if (!isConfigured) {
      setError('Пожалуйста, сначала настройте ваши Google Sheets');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      console.log('📄 Starting multi-project data load from Google Sheets...');
      
      // Load data from configured sheets
      const projectPromises = Object.entries(GOOGLE_SHEETS_URLS).map(([project, url]) =>
        loadSheetData(project, url)
      );
      
      const projectData = await Promise.all(projectPromises);
      
      // Process each sheet's data
      const processedProjects = {};
      Object.keys(GOOGLE_SHEETS_URLS).forEach((project, index) => {
        processedProjects[project] = processSheetData(projectData[index], project);
      });
      
      // Combine data from all projects
      const allUniqueCreatives = new Set();
      const allCreativeHistory = {};
      const allAccounts = [];
      const allActiveCreatives = [];
      
      Object.values(processedProjects).forEach(processed => {
        processed.uniqueCreatives.forEach(creative => allUniqueCreatives.add(creative));
        Object.assign(allCreativeHistory, processed.creativeHistory);
        allAccounts.push(...processed.accounts);
        allActiveCreatives.push(...processed.activeCreativesOnLastDate);
      });
      
      // Use the latest date from any project
      const combinedLatestDate = Object.values(processedProjects)
        .map(p => p.latestDate)
        .sort()
        .reverse()[0];

      // Create final analytics with project information
      const creativeAnalytics = [...allUniqueCreatives].map(creative => {
        const history = allCreativeHistory[creative];
        const isActive = allActiveCreatives.some(item => item.creative === creative);
        
        const currentAccounts = isActive 
          ? allActiveCreatives.filter(item => item.creative === creative).map(item => ({ 
              account: item.account, 
              project: item.project,
              users: item.users 
            }))
          : [];
        
        const currentUsers = isActive
          ? allActiveCreatives.filter(item => item.creative === creative).reduce((sum, item) => sum + item.users, 0)
          : 0;

        // Determine performance
        let performance;
        if (history.totalUsers > 200) {
          performance = 'high';
        } else if (history.totalUsers > 50) {
          performance = 'medium';
        } else {
          if (history.accounts.size > 3 && history.avgUsersPerDay < 2) {
            performance = 'low';
          } else {
            performance = 'medium';
          }
        }

        return {
          id: creative.replace(/[^a-zA-Z0-9]/g, '_'),
          creative: creative,
          status: isActive ? 'active' : 'free',
          totalUsers: history.totalUsers,
          currentUsers: currentUsers,
          daysActive: history.daysActive,
          accounts: [...history.accounts],
          currentAccounts: currentAccounts,
          lastActiveDate: history.lastActiveDate,
          avgUsersPerDay: history.avgUsersPerDay,
          performance: performance,
          efficiency: history.avgUsersPerDay,
          mainProject: history.project,
          project: history.project
        };
      });

      // Sort creatives
      creativeAnalytics.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        if (a.status === 'active') return b.currentUsers - a.currentUsers;
        return b.totalUsers - a.totalUsers;
      });

      // Calculate project statistics
      const projectStats = {};
      Object.keys(config).forEach(projectKey => {
        const projectCreatives = creativeAnalytics.filter(c => c.project === projectKey);
        const projectActiveCreatives = allActiveCreatives.filter(item => item.project === projectKey);
        
        projectStats[projectKey] = {
          totalCreatives: projectCreatives.length,
          activeCreatives: projectCreatives.filter(c => c.status === 'active').length,
          totalUsers: projectCreatives.reduce((sum, c) => sum + c.totalUsers, 0),
          currentUsers: projectActiveCreatives.reduce((sum, item) => sum + item.users, 0),
          totalAccounts: processedProjects[projectKey].accounts.length
        };
      });

      const activeCount = creativeAnalytics.filter(c => c.status === 'active').length;
      const totalCurrentUsers = creativeAnalytics.filter(c => c.status === 'active').reduce((sum, c) => sum + c.currentUsers, 0);

      setDashboardData({
        latestDate: combinedLatestDate,
        creativeAnalytics: creativeAnalytics,
        allAccounts: allAccounts,
        activeCreativesOnLastDate: allActiveCreatives,
        projectStats: projectStats,
        summary: {
          totalCreatives: allUniqueCreatives.size,
          activeCreatives: activeCount,
          freeCreatives: allUniqueCreatives.size - activeCount,
          totalAccounts: allAccounts.length,
          accountColumns: Object.values(processedProjects).reduce((sum, p) => sum + p.accountColumns, 0),
          totalUsersAllTime: creativeAnalytics.reduce((sum, c) => sum + c.totalUsers, 0),
          totalCurrentUsers: totalCurrentUsers,
          avgUsersPerCreative: Math.round((creativeAnalytics.reduce((sum, c) => sum + c.totalUsers, 0) / allUniqueCreatives.size) * 10) / 10
        }
      });

      setLastUpdate(new Date().toLocaleString('ru-RU'));

    } catch (error) {
      console.error('❌ Critical loading error:', error);
      
      let errorMessage = 'Ошибка загрузки данных из Google Sheets';
      
      if (error.message.includes('HTTP 403')) {
        errorMessage = 'Доступ к таблице запрещен. Сделайте таблицу публичной для чтения.';
      } else if (error.message.includes('HTTP 404')) {
        errorMessage = 'Таблица не найдена. Проверьте ID таблицы и GID вкладок.';
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Проблема с интернет-соединением или CORS. Проверьте подключение.';
      } else {
        errorMessage = error.message;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConfigured) {
      loadData();
      
      // Auto-refresh every 5 minutes
      const interval = setInterval(loadData, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [isConfigured, GOOGLE_SHEETS_URLS]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter data with project support
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

  // Show configuration screen if not configured
  if (!isConfigured && !showConfig) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          backgroundColor: '#374151',
          padding: '32px',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          maxWidth: '672px',
          width: '100%',
          margin: '0 16px'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <Settings style={{
              width: '64px',
              height: '64px',
              color: '#60a5fa',
              margin: '0 auto 16px auto'
            }} />
            <h1 style={{
              fontSize: '30px',
              fontWeight: 'bold',
              marginBottom: '8px'
            }}>Добро пожаловать в Multi-Project Dashboard</h1>
            <p style={{ color: '#9ca3af' }}>Настройте ваши Google Таблицы для начала работы</p>
          </div>
          
          <div style={{ marginBottom: '24px' }}>
            <div style={{
              backgroundColor: 'rgba(30, 58, 138, 0.3)',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #2563eb',
              marginBottom: '24px'
            }}>
              <h3 style={{
                fontWeight: '600',
                marginBottom: '8px'
              }}>📋 Инструкция по настройке:</h3>
              <ol style={{
                fontSize: '14px',
                color: '#d1d5db',
                lineHeight: '1.5',
                paddingLeft: '16px'
              }}>
                <li>1. Откройте вашу Google Таблицу с данными креативов</li>
                <li>2. Сделайте её публично доступной (Доступ по ссылке)</li>
                <li>3. Скопируйте URL таблицы и найдите GID каждой вкладки</li>
                <li>4. Настройте ваши проекты ниже</li>
              </ol>
              
              {/* Ссылка на подробный гайд */}
              <div style={{
                marginTop: '12px',
                padding: '12px',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderRadius: '6px',
                border: '1px solid #22c55e'
              }}>
                <p style={{
                  fontSize: '14px',
                  color: '#22c55e',
                  marginBottom: '8px',
                  fontWeight: '500'
                }}>📖 Подробная инструкция:</p>
                <a 
                  href="https://docs.google.com/document/d/19d3df8PlQHD735yJjiVV9HhPWxP71NKnzIN84dn8LSg/edit?usp=sharing"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#22c55e',
                    fontSize: '14px',
                    textDecoration: 'underline'
                  }}
                >
                  Открыть полное руководство по настройке →
                </a>
              </div>
            </div>
            
            <button 
              onClick={() => setShowConfig(true)}
              style={{
                width: '100%',
                backgroundColor: '#2563eb',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <Settings style={{ width: '16px', height: '16px' }} />
              Настроить Google Таблицы
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !dashboardData) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw style={{
            width: '48px',
            height: '48px',
            color: '#60a5fa',
            margin: '0 auto 16px auto',
            animation: 'spin 1s linear infinite'
          }} />
          <p style={{ fontSize: '20px' }}>Загрузка данных из Google Таблиц...</p>
          <p style={{
            fontSize: '14px',
            color: '#9ca3af',
            marginTop: '8px'
          }}>Подключение к настроенным таблицам</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ textAlign: 'center' }}>
          <AlertCircle style={{
            width: '64px',
            height: '64px',
            color: '#f87171',
            margin: '0 auto 16px auto'
          }} />
          <p style={{
            fontSize: '20px',
            color: '#f87171'
          }}>Ошибка подключения</p>
          <p style={{
            color: '#9ca3af',
            marginBottom: '16px'
          }}>{error}</p>
          <div style={{
            display: 'flex',
            gap: '16px',
            justifyContent: 'center'
          }}>
            <button 
              onClick={loadData}
              style={{
                backgroundColor: '#2563eb',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <RefreshCw style={{ width: '16px', height: '16px' }} />
              Попробовать снова
            </button>
            <button 
              onClick={() => setShowConfig(true)}
              style={{
                backgroundColor: '#4b5563',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Settings style={{ width: '16px', height: '16px' }} />
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
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)',
      color: 'white',
      padding: '24px'
    }}>
      {/* Configuration Modal */}
      {showConfig && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: '#374151',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '896px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <h2 style={{
                fontSize: '24px',
                fontWeight: 'bold'
              }}>Настройка Google Таблиц</h2>
              <button 
                onClick={resetConfig}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer'
                }}
              >
                <X style={{ width: '24px', height: '24px' }} />
              </button>
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              {Object.entries(tempConfig).map(([projectKey, project]) => (
                <div key={projectKey} style={{
                  backgroundColor: '#4b5563',
                  padding: '16px',
                  borderRadius: '8px',
                  marginBottom: '24px'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '16px'
                  }}>
                    <span style={{ fontSize: '24px' }}>{project.emoji}</span>
                    <input
                      type="text"
                      placeholder="Название проекта"
                      style={{
                        backgroundColor: '#6b7280',
                        color: 'white',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        fontWeight: '600'
                      }}
                      value={project.name}
                      onChange={(e) => setTempConfig(prev => ({
                        ...prev,
                        [projectKey]: { ...prev[projectKey], name: e.target.value }
                      }))}
                    />
                  </div>
                  
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: '500',
                      marginBottom: '8px'
                    }}>URL Google Таблицы или ID таблицы:</label>
                    <input
                      type="text"
                      placeholder="https://docs.google.com/spreadsheets/d/ВАШ_ID_ТАБЛИЦЫ или только ID"
                      style={{
                        width: '100%',
                        backgroundColor: '#6b7280',
                        color: 'white',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        boxSizing: 'border-box'
                      }}
                      value={project.url}
                      onChange={(e) => handleUrlChange(projectKey, e.target.value)}
                    />
                    <p style={{
                      fontSize: '12px',
                      color: '#9ca3af',
                      marginTop: '4px'
                    }}>
                      Вставьте полный URL или только ID таблицы
                    </p>
                  </div>
                  
                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: '500',
                      marginBottom: '8px'
                    }}>GID вкладки (ID вкладки):</label>
                    <input
                      type="text"
                      placeholder="0 (для первой вкладки) или конкретный GID"
                      style={{
                        width: '100%',
                        backgroundColor: '#6b7280',
                        color: 'white',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        boxSizing: 'border-box'
                      }}
                      value={project.gid}
                      onChange={(e) => setTempConfig(prev => ({
                        ...prev,
                        [projectKey]: { ...prev[projectKey], gid: e.target.value }
                      }))}
                    />
                    <p style={{
                      fontSize: '12px',
                      color: '#9ca3af',
                      marginTop: '4px'
                    }}>
                      Найдите в URL при просмотре конкретной вкладки: #gid=123456789
                    </p>
                  </div>
                </div>
              ))}
            </div>
            
            <div style={{
              backgroundColor: 'rgba(30, 58, 138, 0.3)',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #2563eb',
              marginBottom: '24px'
            }}>
              <h4 style={{
                fontWeight: '600',
                marginBottom: '8px'
              }}>💡 Краткое руководство:</h4>
              <div style={{
                fontSize: '14px',
                color: '#d1d5db',
                lineHeight: '1.5'
              }}>
                <p><strong>1. Откройте доступ к Google Таблице:</strong> Файл → Поделиться → Доступ по ссылке</p>
                <p><strong>2. Скопируйте URL:</strong> Адресная строка браузера при просмотре таблицы</p>
                <p><strong>3. Найдите GID:</strong> У каждой вкладки есть #gid=ЦИФРЫ в конце URL</p>
                <p><strong>4. Формат данных:</strong> Колонки должны быть Date, Account_1, Creative_1, Users_1, Account_2, и т.д.</p>
              </div>
            </div>
            
            <div style={{
              display: 'flex',
              gap: '16px'
            }}>
              <button 
                onClick={saveConfig}
                style={{
                  flex: 1,
                  backgroundColor: '#2563eb',
                  color: 'white',
                  padding: '12px 24px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <Save style={{ width: '16px', height: '16px' }} />
                Сохранить настройки
              </button>
              <button 
                onClick={resetConfig}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#6b7280',
                  color: 'white',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px'
        }}>
          <div>
            <h1 style={{
              fontSize: '36px',
              fontWeight: 'bold',
              background: 'linear-gradient(to right, #60a5fa, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              Multi-Project Creative Analytics Dashboard
            </h1>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              marginTop: '8px'
            }}>
              <p style={{ color: '#9ca3af' }}>
                📅 Последняя дата: <span style={{ fontWeight: '600', color: 'white' }}>{dashboardData.latestDate}</span> | 
                📊 {stats.totalCreatives} креативов | 
                🏢 {stats.totalAccounts} аккаунтов |
                📋 {stats.accountColumns} колонок данных
              </p>
              
              {/* Quick project switchers */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <button
                  onClick={() => setProjectFilter('all')}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '500',
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: projectFilter === 'all' ? '#2563eb' : '#4b5563',
                    color: 'white'
                  }}
                >
                  📊 Все проекты
                </button>
                {Object.entries(config).map(([projectKey, project]) => (
                  <button
                    key={projectKey}
                    onClick={() => setProjectFilter(projectKey)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: '500',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: projectFilter === projectKey ? '#059669' : '#4b5563',
                      color: 'white'
                    }}
                  >
                    {project.emoji} {project.name} ({dashboardData.projectStats[projectKey]?.activeCreatives || 0})
                  </button>
                ))}
              </div>
            </div>
            {lastUpdate && (
              <p style={{
                fontSize: '12px',
                color: '#6b7280',
                marginTop: '4px'
              }}>
                🔄 Последнее обновление: {lastUpdate}
              </p>
            )}
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px'
          }}>
            <button 
              onClick={() => setShowConfig(true)}
              style={{
                backgroundColor: '#6b7280',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Settings style={{ width: '16px', height: '16px' }} />
              Настроить
            </button>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontSize: '14px',
                color: '#9ca3af'
              }}>Синхронизация с Google Таблицами</div>
              <div style={{
                fontSize: '18px',
                fontWeight: '600',
                color: '#10b981'
              }}>
                {loading ? 'Обновление...' : '✓ Подключено'}
              </div>
            </div>
            <button 
              onClick={loadData}
              disabled={loading}
              style={{
                backgroundColor: loading ? '#6b7280' : '#2563eb',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <RefreshCw style={{ 
                width: '16px', 
                height: '16px',
                animation: loading ? 'spin 1s linear infinite' : 'none'
              }} />
              Обновить
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px'
        }}>
          <div style={{
            background: 'linear-gradient(to right, #059669, #047857)',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '14px'
                }}>🟢 Активные</p>
                <p style={{
                  fontSize: '30px',
                  fontWeight: 'bold'
                }}>
                  {projectFilter === 'all' ? stats.activeCreatives : 
                   dashboardData.projectStats[projectFilter]?.activeCreatives || 0}
                </p>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '12px',
                  marginTop: '4px'
                }}>
                  {Math.round((
                    (projectFilter === 'all' ? stats.activeCreatives : 
                     dashboardData.projectStats[projectFilter]?.activeCreatives || 0) / 
                    (projectFilter === 'all' ? stats.totalCreatives :
                     dashboardData.projectStats[projectFilter]?.totalCreatives || 1)
                  ) * 100)}% от всех
                </p>
              </div>
              <Play style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(to right, #6b7280, #4b5563)',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '14px'
                }}>⚪ Свободные</p>
                <p style={{
                  fontSize: '30px',
                  fontWeight: 'bold'
                }}>
                  {projectFilter === 'all' ? stats.freeCreatives : 
                   ((dashboardData.projectStats[projectFilter]?.totalCreatives || 0) - (dashboardData.projectStats[projectFilter]?.activeCreatives || 0))}
                </p>
              </div>
              <Pause style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(to right, #2563eb, #1d4ed8)',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '14px'
                }}>👥 Сегодня</p>
                <p style={{
                  fontSize: '24px',
                  fontWeight: 'bold'
                }}>
                  {projectFilter === 'all' ? stats.totalCurrentUsers.toLocaleString() : 
                   (dashboardData.projectStats[projectFilter]?.currentUsers || 0).toLocaleString()}
                </p>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '12px',
                  marginTop: '4px'
                }}>активных пользователей</p>
              </div>
              <Users style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(to right, #7c3aed, #6d28d9)',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '14px'
                }}>📈 За всё время</p>
                <p style={{
                  fontSize: '24px',
                  fontWeight: 'bold'
                }}>
                  {projectFilter === 'all' ? stats.totalUsersAllTime.toLocaleString() : 
                   (dashboardData.projectStats[projectFilter]?.totalUsers || 0).toLocaleString()}
                </p>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '12px',
                  marginTop: '4px'
                }}>всего пользователей</p>
              </div>
              <BarChart3 style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(to right, #d97706, #b45309)',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '14px'
                }}>🎯 Аккаунты</p>
                <p style={{
                  fontSize: '30px',
                  fontWeight: 'bold'
                }}>
                  {projectFilter === 'all' ? stats.totalAccounts : 
                   dashboardData.projectStats[projectFilter]?.totalAccounts || 0}
                </p>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '12px',
                  marginTop: '4px'
                }}>активных</p>
              </div>
              <Target style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(to right, #4f46e5, #3730a3)',
            padding: '24px',
            borderRadius: '12px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '14px'
                }}>📊 Всего креативов</p>
                <p style={{
                  fontSize: '30px',
                  fontWeight: 'bold'
                }}>
                  {projectFilter === 'all' ? stats.totalCreatives : 
                   dashboardData.projectStats[projectFilter]?.totalCreatives || 0}
                </p>
                <p style={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '12px',
                  marginTop: '4px'
                }}>в проекте</p>
              </div>
              <Eye style={{ width: '32px', height: '32px', color: 'rgba(255, 255, 255, 0.7)' }} />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div style={{
          backgroundColor: '#374151',
          padding: '24px',
          borderRadius: '12px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          marginBottom: '24px'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px'
          }}>
            <div style={{ position: 'relative' }}>
              <Search style={{
                position: 'absolute',
                left: '12px',
                top: '12px',
                width: '20px',
                height: '20px',
                color: '#9ca3af'
              }} />
              <input
                type="text"
                placeholder="Поиск креативов..."
                style={{
                  width: '100%',
                  backgroundColor: '#4b5563',
                  color: 'white',
                  paddingLeft: '40px',
                  paddingRight: '16px',
                  paddingTop: '12px',
                  paddingBottom: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  boxSizing: 'border-box'
                }}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select 
              style={{
                backgroundColor: '#4b5563',
                color: 'white',
                padding: '12px 16px',
                borderRadius: '8px',
                border: 'none'
              }}
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="all">🎯 Все проекты</option>
              {Object.entries(config).map(([projectKey, project]) => (
                <option key={projectKey} value={projectKey}>
                  {project.emoji} {project.name} ({dashboardData.projectStats[projectKey]?.totalCreatives || 0})
                </option>
              ))}
            </select>

            <select 
              style={{
                backgroundColor: '#4b5563',
                color: 'white',
                padding: '12px 16px',
                borderRadius: '8px',
                border: 'none'
              }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">📋 Все статусы</option>
              <option value="active">🟢 Активные ({
                projectFilter === 'all' ? stats.activeCreatives : 
                dashboardData.projectStats[projectFilter]?.activeCreatives || 0
              })</option>
              <option value="free">⚪ Свободные</option>
            </select>

            <select 
              style={{
                backgroundColor: '#4b5563',
                color: 'white',
                padding: '12px 16px',
                borderRadius: '8px',
                border: 'none'
              }}
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
            >
              <option value="all">🏢 Все аккаунты</option>
              {dashboardData.allAccounts.map(account => (
                <option key={account} value={account}>
                  {account.length > 20 ? account.substring(0, 20) + '...' : account}
                </option>
              ))}
            </select>

            <select 
              style={{
                backgroundColor: '#4b5563',
                color: 'white',
                padding: '12px 16px',
                borderRadius: '8px',
                border: 'none'
              }}
              value={performanceFilter}
              onChange={(e) => setPerformanceFilter(e.target.value)}
            >
              <option value="all">📊 Вся эффективность</option>
              <option value="high">🔥 Высокая (200+ пользователей)</option>
              <option value="medium">📈 Средняя (50-200 или новые)</option>
              <option value="low">📉 Низкая (3+ аккаунтов, &lt;2/день)</option>
            </select>

            <div style={{
              backgroundColor: '#4b5563',
              padding: '12px 16px',
              borderRadius: '8px',
              color: '#d1d5db',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center'
            }}>
              <Filter style={{ width: '16px', height: '16px', marginRight: '8px' }} />
              Показано: {filteredCreatives.length}
            </div>
          </div>
        </div>
      </div>

      {/* Creatives Table */}
      <div style={{
        backgroundColor: '#374151',
        borderRadius: '12px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden'
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%' }}>
            <thead style={{ backgroundColor: '#4b5563' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Статус</th>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Проект</th>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Креатив</th>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Пользователи сегодня</th>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Всего за всё время</th>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>Текущие аккаунты</th>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>📅 Дней активен</th>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>📊 Среднее/день</th>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>🏢 Всего аккаунтов</th>
                <th style={{ textAlign: 'left', padding: '16px', fontWeight: '600' }}>📈 Эффективность</th>
              </tr>
            </thead>
            <tbody>
              {filteredCreatives.map((creative, index) => {
                const isActive = creative.status === 'active';
                const performanceColor = creative.performance === 'high' ? '#10b981' : 
                                       creative.performance === 'medium' ? '#f59e0b' : '#ef4444';
                const projectConfig = config[creative.project] || { name: creative.project, emoji: '📊' };
                
                return (
                  <tr 
                    key={creative.id} 
                    style={{
                      borderTop: '1px solid #4b5563',
                      backgroundColor: index % 2 === 0 ? '#374151' : '#475569'
                    }}
                  >
                    <td style={{ padding: '16px' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '14px',
                        fontWeight: '500',
                        width: 'fit-content',
                        backgroundColor: isActive ? '#065f46' : '#4b5563',
                        color: isActive ? '#10b981' : '#d1d5db',
                        border: `1px solid ${isActive ? '#10b981' : '#6b7280'}`
                      }}>
                        {isActive ? <Play style={{ width: '12px', height: '12px' }} /> : <Pause style={{ width: '12px', height: '12px' }} />}
                        {isActive ? 'Активен' : 'Свободен'}
                      </div>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <div style={{
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '14px',
                        fontWeight: '500',
                        width: 'fit-content',
                        backgroundColor: creative.project === 'SnellCoin' ? '#065f46' : '#581c87',
                        color: creative.project === 'SnellCoin' ? '#10b981' : '#a78bfa',
                        border: creative.project === 'SnellCoin' ? '1px solid #10b981' : '1px solid #a78bfa'
                      }}>
                        {projectConfig.emoji} {projectConfig.name}
                      </div>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <div style={{ fontWeight: '500' }}>
                        <div style={{ color: 'white', fontFamily: 'monospace' }}>{creative.creative}</div>
                        <div style={{
                          fontSize: '14px',
                          color: '#9ca3af'
                        }}>
                          {creative.creative.includes('.mp4') ? '🎥 Видео' : '🎨 Креатив'}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '16px' }}>
                      {isActive ? (
                        <div style={{
                          fontFamily: 'monospace',
                          fontSize: '18px',
                          fontWeight: 'bold',
                          color: creative.currentUsers > 5 ? '#10b981' : creative.currentUsers > 2 ? '#f59e0b' : '#9ca3af'
                        }}>
                          {creative.currentUsers}
                        </div>
                      ) : (
                        <span style={{ color: '#6b7280' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '16px' }}>
                      <div style={{
                        fontFamily: 'monospace',
                        color: performanceColor
                      }}>
                        {creative.totalUsers.toLocaleString()}
                      </div>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <div>
                        {creative.currentAccounts.slice(0, 2).map(accInfo => (
                          <span key={accInfo.account} style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            marginRight: '4px',
                            marginBottom: '4px',
                            backgroundColor: '#4b5563',
                            color: '#d1d5db'
                          }}>
                            {accInfo.account.length > 10 ? accInfo.account.substring(0, 10) + '...' : accInfo.account} ({accInfo.users})
                          </span>
                        ))}
                        {creative.currentAccounts.length > 2 && (
                          <span style={{
                            color: '#9ca3af',
                            fontSize: '12px'
                          }}>
                            +{creative.currentAccounts.length - 2} ещё
                          </span>
                        )}
                        {creative.currentAccounts.length === 0 && (
                          <span style={{
                            color: '#6b7280',
                            fontSize: '14px'
                          }}>Не активен</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '16px', fontFamily: 'monospace' }}>{creative.daysActive}</td>
                    <td style={{ padding: '16px', fontFamily: 'monospace' }}>{creative.avgUsersPerDay}</td>
                    <td style={{ padding: '16px', fontFamily: 'monospace' }}>{creative.accounts.length}</td>
                    <td style={{ padding: '16px' }}>
                      <div style={{
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '14px',
                        fontWeight: '500',
                        width: 'fit-content',
                        backgroundColor: creative.performance === 'high' ? '#065f46' :
                        creative.performance === 'medium' ? '#92400e' : '#7f1d1d',
                        color: creative.performance === 'high' ? '#10b981' :
                        creative.performance === 'medium' ? '#fbbf24' : '#f87171'
                      }}>
                        {creative.performance === 'high' ? '🔥 Высокая' :
                         creative.performance === 'medium' ? '📈 Средняя' :
                         '📉 Низкая'}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {filteredCreatives.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '48px 0'
        }}>
          <Eye style={{
            width: '64px',
            height: '64px',
            color: '#6b7280',
            margin: '0 auto 16px auto'
          }} />
          <p style={{
            color: '#9ca3af',
            fontSize: '18px'
          }}>Креативы не найдены</p>
          <p style={{
            color: '#6b7280',
            fontSize: '14px'
          }}>Попробуйте изменить фильтры поиска</p>
        </div>
      )}
    </div>
  );
}

export default App;
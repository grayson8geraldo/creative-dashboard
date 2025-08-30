import React, { useState, useEffect, useMemo } from 'react';
// ИСПРАВЛЕНО: Удалены неиспользуемые иконки
import { RefreshCw, AlertCircle, Settings, Save, X } from 'lucide-react';

function App() {
  // ИСПРАВЛЕНО: Полностью удалены состояния для фильтров, так как они не использовались
  
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
    // Перезагружаем данные после сохранения новой конфигурации
    setTimeout(loadData, 100);
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
      setError('Please configure your Google Sheets URLs first');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      console.log('📄 Starting multi-project data load from Google Sheets...');
      
      const projectPromises = Object.entries(GOOGLE_SHEETS_URLS).map(([project, url]) =>
        loadSheetData(project, url)
      );
      
      const projectData = await Promise.all(projectPromises);
      
      const processedProjects = {};
      Object.keys(GOOGLE_SHEETS_URLS).forEach((project, index) => {
        processedProjects[project] = processSheetData(projectData[index], project);
      });
      
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
      
      const combinedLatestDate = Object.values(processedProjects)
        .map(p => p.latestDate)
        .filter(Boolean)
        .sort()
        .reverse()[0];

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

      creativeAnalytics.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        if (a.status === 'active') return b.currentUsers - a.currentUsers;
        return b.totalUsers - a.totalUsers;
      });

      const projectStats = {};
      Object.keys(config).forEach(projectKey => {
        if (!processedProjects[projectKey]) return;
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
        allAccounts: [...new Set(allAccounts)],
        activeCreativesOnLastDate: allActiveCreatives,
        projectStats: projectStats,
        summary: {
          totalCreatives: allUniqueCreatives.size,
          activeCreatives: activeCount,
          freeCreatives: allUniqueCreatives.size - activeCount,
          totalAccounts: new Set(allAccounts).size,
          accountColumns: Object.values(processedProjects).reduce((sum, p) => sum + (p.accountColumns || 0), 0),
          totalUsersAllTime: creativeAnalytics.reduce((sum, c) => sum + c.totalUsers, 0),
          totalCurrentUsers: totalCurrentUsers,
          avgUsersPerCreative: allUniqueCreatives.size > 0 ? Math.round((creativeAnalytics.reduce((sum, c) => sum + c.totalUsers, 0) / allUniqueCreatives.size) * 10) / 10 : 0
        }
      });

      setLastUpdate(new Date().toLocaleString('ru-RU'));

    } catch (error) {
      console.error('❌ Critical loading error:', error);
      
      let errorMessage = 'Error loading data from Google Sheets';
      
      if (error.message.includes('HTTP 403')) {
        errorMessage = 'Access denied to spreadsheet. Make the spreadsheet public for reading.';
      } else if (error.message.includes('HTTP 404')) {
        errorMessage = 'Spreadsheet not found. Check the spreadsheet ID and sheet GIDs.';
      } else if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Internet connection problem or CORS issue. Check your connection.';
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
      
      const interval = setInterval(loadData, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [isConfigured, GOOGLE_SHEETS_URLS]); // eslint-disable-line react-hooks/exhaustive-deps

  // ИСПРАВЛЕНО: Полностью удален блок useMemo для filteredCreatives, так как он не использовался
  
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
            }}>Welcome to Multi-Project Dashboard</h1>
            <p style={{ color: '#9ca3af' }}>Configure your Google Sheets to get started</p>
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
              }}>📋 Setup Instructions:</h3>
              <ol style={{
                fontSize: '14px',
                color: '#d1d5db',
                lineHeight: '1.5',
                paddingLeft: '16px'
              }}>
                <li>1. Open your Google Sheet with creative analytics data</li>
                <li>2. Make sure it's publicly accessible (Anyone with link can view)</li>
                <li>3. Copy the sheet URL and find the GID for each tab</li>
                <li>4. Configure your projects below</li>
              </ol>
            </div>
            
            <button 
              onClick={() => {
                console.log('Button clicked - opening config');
                setShowConfig(true);
              }}
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
                gap: '8px',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#1d4ed8'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#2563eb'}
            >
              <Settings style={{ width: '16px', height: '16px' }} />
              Configure Google Sheets
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
          <p style={{ fontSize: '20px' }}>Loading multi-project data from Google Sheets...</p>
          <p style={{
            fontSize: '14px',
            color: '#9ca3af',
            marginTop: '8px'
          }}>Connecting to configured sheets</p>
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
          }}>Connection Error</p>
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
              Try Again
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
              Configure
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1f2937, #111827, #1f2937)',
      color: 'white',
      padding: '24px'
    }}>
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
              }}>Configure Google Sheets</h2>
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
                      placeholder="Project Name"
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
                    }}>Google Sheet URL or Spreadsheet ID:</label>
                    <input
                      type="text"
                      placeholder="https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID or just the ID"
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
                      Paste the full URL or just the spreadsheet ID
                    </p>
                  </div>
                  
                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: '500',
                      marginBottom: '8px'
                    }}>Sheet GID (Tab ID):</label>
                    <input
                      type="text"
                      placeholder="0 (for first tab) or specific GID"
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
                      Find this in the URL when viewing the specific tab: #gid=123456789
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
              }}>💡 Quick Setup Guide:</h4>
              <div style={{
                fontSize: '14px',
                color: '#d1d5db',
                lineHeight: '1.5'
              }}>
                <p><strong>1. Share your Google Sheet:</strong> File → Share → Anyone with link can view</p>
                <p><strong>2. Copy the URL:</strong> Your browser's address bar when viewing the sheet</p>
                <p><strong>3. Find GID:</strong> Each tab has #gid=NUMBERS at the end of URL</p>
                <p><strong>4. Data format:</strong> Columns should be Date, Account_1, Creative_1, Users_1, Account_2, etc.</p>
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
                Save Configuration
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
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {dashboardData && (
        <>
          {(() => {
            const stats = dashboardData.summary;
            return (
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
                    <p style={{
                      color: '#9ca3af',
                      marginTop: '8px'
                    }}>
                      📅 Latest date: <span style={{ fontWeight: '600', color: 'white' }}>{dashboardData.latestDate}</span> | 
                      📊 {stats.totalCreatives} creatives | 
                      🏢 {stats.totalAccounts} accounts |
                      📋 {stats.accountColumns} data columns
                    </p>
                    {lastUpdate && (
                      <p style={{
                        fontSize: '12px',
                        color: '#6b7280',
                        marginTop: '4px'
                      }}>
                        🔄 Last update: {lastUpdate}
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
                      Configure
                    </button>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontSize: '14px',
                        color: '#9ca3af'
                      }}>Google Sheets sync</div>
                      <div style={{
                        fontSize: '18px',
                        fontWeight: '600',
                        color: '#10b981'
                      }}>
                        {loading ? 'Updating...' : '✓ Connected'}
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
                      Refresh
                    </button>
                  </div>
                </div>

                <div style={{
                  backgroundColor: '#374151',
                  padding: '24px',
                  borderRadius: '12px'
                }}>
                  <h2>Dashboard Content</h2>
                  <p>Active Creatives: {stats.activeCreatives}</p>
                  <p>Total Users: {stats.totalCurrentUsers}</p>
                  <p>Total Accounts: {stats.totalAccounts}</p>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

export default App;
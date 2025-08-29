import React, { useState, useEffect, useMemo } from 'react';
import { Play, Pause, TrendingUp, TrendingDown, Eye, Users, Target, Clock, Filter, Search, RefreshCw, Calendar, BarChart3, AlertCircle, Settings, Save, X } from 'lucide-react';

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

  // Function to extract spreadsheet ID from Google Sheets URL
  const extractSpreadsheetId = (url) => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : '';
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
      
      // Auto-refresh every 5 minutes
      const interval = setInterval(loadData, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [isConfigured, GOOGLE_SHEETS_URLS]);

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
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-xl shadow-lg max-w-2xl w-full mx-4">
          <div className="text-center mb-8">
            <Settings className="w-16 h-16 text-blue-400 mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-2">Welcome to Multi-Project Dashboard</h1>
            <p className="text-gray-400">Configure your Google Sheets to get started</p>
          </div>
          
          <div className="space-y-6">
            <div className="bg-blue-900/30 p-4 rounded-lg border border-blue-600">
              <h3 className="font-semibold mb-2">📋 Setup Instructions:</h3>
              <ol className="text-sm space-y-1 text-gray-300">
                <li>1. Open your Google Sheet with creative analytics data</li>
                <li>2. Make sure it's publicly accessible (Anyone with link can view)</li>
                <li>3. Copy the sheet URL and find the GID for each tab</li>
                <li>4. Configure your projects below</li>
              </ol>
            </div>
            
            <button 
              onClick={() => setShowConfig(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Settings className="w-4 h-4" />
              Configure Google Sheets
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !dashboardData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-400" />
          <p className="text-xl">Loading multi-project data from Google Sheets...</p>
          <p className="text-sm text-gray-400 mt-2">Connecting to configured sheets</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <p className="text-xl text-red-400">Connection Error</p>
          <p className="text-gray-400 mb-4">{error}</p>
          <div className="flex gap-4 justify-center">
            <button 
              onClick={loadData}
              className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg flex items-center gap-2 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <button 
              onClick={() => setShowConfig(true)}
              className="bg-gray-600 hover:bg-gray-700 px-6 py-3 rounded-lg flex items-center gap-2 transition-colors"
            >
              <Settings className="w-4 h-4" />
              Configure
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!dashboardData) return null;

  const stats = dashboardData.summary;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white p-6">
      {/* Configuration Modal */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Configure Google Sheets</h2>
              <button onClick={resetConfig} className="text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-6">
              {Object.entries(tempConfig).map(([projectKey, project]) => (
                <div key={projectKey} className="bg-gray-700 p-4 rounded-lg">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl">{project.emoji}</span>
                    <input
                      type="text"
                      placeholder="Project Name"
                      className="bg-gray-600 text-white px-3 py-2 rounded font-semibold"
                      value={project.name}
                      onChange={(e) => setTempConfig(prev => ({
                        ...prev,
                        [projectKey]: { ...prev[projectKey], name: e.target.value }
                      }))}
                    />
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-2">Google Sheet URL or Spreadsheet ID:</label>
                      <input
                        type="text"
                        placeholder="https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID or just the ID"
                        className="w-full bg-gray-600 text-white px-3 py-2 rounded"
                        value={project.url}
                        onChange={(e) => handleUrlChange(projectKey, e.target.value)}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Paste the full URL or just the spreadsheet ID
                      </p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium mb-2">Sheet GID (Tab ID):</label>
                      <input
                        type="text"
                        placeholder="0 (for first tab) or specific GID"
                        className="w-full bg-gray-600 text-white px-3 py-2 rounded"
                        value={project.gid}
                        onChange={(e) => setTempConfig(prev => ({
                          ...prev,
                          [projectKey]: { ...prev[projectKey], gid: e.target.value }
                        }))}
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Find this in the URL when viewing the specific tab: #gid=123456789
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="bg-blue-900/30 p-4 rounded-lg border border-blue-600 mt-6">
              <h4 className="font-semibold mb-2">💡 Quick Setup Guide:</h4>
              <div className="text-sm space-y-2 text-gray-300">
                <p><strong>1. Share your Google Sheet:</strong> File → Share → Anyone with link can view</p>
                <p><strong>2. Copy the URL:</strong> Your browser's address bar when viewing the sheet</p>
                <p><strong>3. Find GID:</strong> Each tab has #gid=NUMBERS at the end of URL</p>
                <p><strong>4. Data format:</strong> Columns should be Date, Account_1, Creative_1, Users_1, Account_2, etc.</p>
              </div>
            </div>
            
            <div className="flex gap-4 mt-6">
              <button 
                onClick={saveConfig}
                className="flex-1 bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <Save className="w-4 h-4" />
                Save Configuration
              </button>
              <button 
                onClick={resetConfig}
                className="px-6 py-3 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Multi-Project Creative Analytics Dashboard
            </h1>
            <div className="flex items-center gap-4 mt-2">
              <p className="text-gray-400">
                📅 Latest date: <span className="font-semibold text-white">{dashboardData.latestDate}</span> | 
                📊 {stats.totalCreatives} creatives | 
                🏢 {stats.totalAccounts} accounts |
                📋 {stats.accountColumns} data columns
              </p>
              
              {/* Quick project switchers */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setProjectFilter('all')}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    projectFilter === 'all' 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  📊 All Projects
                </button>
                {Object.entries(config).map(([projectKey, project]) => (
                  <button
                    key={projectKey}
                    onClick={() => setProjectFilter(projectKey)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                      projectFilter === projectKey 
                        ? 'bg-green-600 text-white' 
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {project.emoji} {project.name} ({dashboardData.projectStats[projectKey]?.activeCreatives || 0})
                  </button>
                ))}
              </div>
            </div>
            {lastUpdate && (
              <p className="text-xs text-gray-500 mt-1">
                🔄 Last update: {lastUpdate}
              </p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowConfig(true)}
              className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            >
              <Settings className="w-4 h-4" />
              Configure
            </button>
            <div className="text-right">
              <div className="text-sm text-gray-400">Google Sheets sync</div>
              <div className="text-lg font-semibold text-green-400">
                {loading ? 'Updating...' : '✓ Connected'}
              </div>
            </div>
            <button 
              onClick={loadData}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          <div className="bg-gradient-to-r from-green-600 to-green-700 p-6 rounded-xl shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm">🟢 Active</p>
                <p className="text-3xl font-bold">
                  {projectFilter === 'all' ? stats.activeCreatives : 
                   dashboardData.projectStats[projectFilter]?.activeCreatives || 0}
                </p>
                <p className="text-green-200 text-xs mt-1">
                  {Math.round((
                    (projectFilter === 'all' ? stats.activeCreatives : 
                     dashboardData.projectStats[projectFilter]?.activeCreatives || 0) / 
                    (projectFilter === 'all' ? stats.totalCreatives :
                     dashboardData.projectStats[projectFilter]?.totalCreatives || 1)
                  ) * 100)}% of all
                </p>
              </div>
              <Play className="w-8 h-8 text-green-200" />
            </div>
          </div>

          <div className="bg-gradient-to-r from-gray-600 to-gray-700 p-6 rounded-xl shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-100 text-sm">⚪ Free</p>
                <p className="text-3xl font-bold">
                  {projectFilter === 'all' ? stats.freeCreatives : 
                   ((dashboardData.projectStats[projectFilter]?.totalCreatives || 0) - (dashboardData.projectStats[projectFilter]?.activeCreatives || 0))}
                </p>
              </div>
              <Pause className="w-8 h-8 text-gray-200" />
            </div>
          </div>

          <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 rounded-xl shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">👥 Today</p>
                <p className="text-2xl font-bold">
                  {projectFilter === 'all' ? stats.totalCurrentUsers.toLocaleString() : 
                   (dashboardData.projectStats[projectFilter]?.currentUsers || 0).toLocaleString()}
                </p>
                <p className="text-blue-200 text-xs mt-1">active users</p>
              </div>
              <Users className="w-8 h-8 text-blue-200" />
            </div>
          </div>

          <div className="bg-gradient-to-r from-purple-600 to-purple-700 p-6 rounded-xl shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm">📈 All time</p>
                <p className="text-2xl font-bold">
                  {projectFilter === 'all' ? stats.totalUsersAllTime.toLocaleString() : 
                   (dashboardData.projectStats[projectFilter]?.totalUsers || 0).toLocaleString()}
                </p>
                <p className="text-purple-200 text-xs mt-1">total users</p>
              </div>
              <BarChart3 className="w-8 h-8 text-purple-200" />
            </div>
          </div>

          <div className="bg-gradient-to-r from-yellow-600 to-orange-600 p-6 rounded-xl shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-100 text-sm">🎯 Accounts</p>
                <p className="text-3xl font-bold">
                  {projectFilter === 'all' ? stats.totalAccounts : 
                   dashboardData.projectStats[projectFilter]?.totalAccounts || 0}
                </p>
                <p className="text-yellow-200 text-xs mt-1">active</p>
              </div>
              <Target className="w-8 h-8 text-yellow-200" />
            </div>
          </div>

          <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 p-6 rounded-xl shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-indigo-100 text-sm">📊 Total creatives</p>
                <p className="text-3xl font-bold">
                  {projectFilter === 'all' ? stats.totalCreatives : 
                   dashboardData.projectStats[projectFilter]?.totalCreatives || 0}
                </p>
                <p className="text-indigo-200 text-xs mt-1">in project</p>
              </div>
              <Eye className="w-8 h-8 text-indigo-200" />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gray-800 p-6 rounded-xl shadow-lg mb-6">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search creatives..."
                className="w-full bg-gray-700 text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select 
              className="bg-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="all">🎯 All Projects</option>
              {Object.entries(config).map(([projectKey, project]) => (
                <option key={projectKey} value={projectKey}>
                  {project.emoji} {project.name} ({dashboardData.projectStats[projectKey]?.totalCreatives || 0})
                </option>
              ))}
            </select>

            <select 
              className="bg-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">📋 All statuses</option>
              <option value="active">🟢 Active ({
                projectFilter === 'all' ? stats.activeCreatives : 
                dashboardData.projectStats[projectFilter]?.activeCreatives || 0
              })</option>
              <option value="free">⚪ Free</option>
            </select>

            <select 
              className="bg-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
            >
              <option value="all">🏢 All accounts</option>
              {dashboardData.allAccounts.map(account => (
                <option key={account} value={account}>
                  {account.length > 20 ? account.substring(0, 20) + '...' : account}
                </option>
              ))}
            </select>

            <select 
              className="bg-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={performanceFilter}
              onChange={(e) => setPerformanceFilter(e.target.value)}
            >
              <option value="all">📊 All performance</option>
              <option value="high">🔥 High (200+ users)</option>
              <option value="medium">📈 Medium (50-200 or new)</option>
              <option value="low">📉 Low (3+ accounts, &lt;2/day)</option>
            </select>

            <div className="bg-gray-700 px-4 py-3 rounded-lg text-gray-300 text-sm flex items-center">
              <Filter className="w-4 h-4 mr-2" />
              Showing: {filteredCreatives.length}
            </div>
          </div>
        </div>
      </div>

      {/* Creatives Table */}
      <div className="bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="text-left p-4 font-semibold">Status</th>
                <th className="text-left p-4 font-semibold">Project</th>
                <th className="text-left p-4 font-semibold">Creative</th>
                <th className="text-left p-4 font-semibold">Current Users</th>
                <th className="text-left p-4 font-semibold">Total All Time</th>
                <th className="text-left p-4 font-semibold">Current Accounts</th>
                <th className="text-left p-4 font-semibold">📅 Days Active</th>
                <th className="text-left p-4 font-semibold">📊 Avg/day</th>
                <th className="text-left p-4 font-semibold">🏢 Total Accounts</th>
                <th className="text-left p-4 font-semibold">📈 Performance</th>
              </tr>
            </thead>
            <tbody>
              {filteredCreatives.map((creative, index) => {
                const isActive = creative.status === 'active';
                const performanceColor = creative.performance === 'high' ? 'text-green-400' : 
                                       creative.performance === 'medium' ? 'text-yellow-400' : 'text-red-400';
                const projectConfig = config[creative.project] || { name: creative.project, emoji: '📊' };
                
                return (
                  <tr 
                    key={creative.id} 
                    className={`border-t border-gray-700 hover:bg-gray-750 transition-colors ${
                      index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-825'
                    }`}
                  >
                    <td className="p-4">
                      <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium w-fit ${
                        isActive 
                          ? 'bg-green-900 text-green-300 border border-green-600' 
                          : 'bg-gray-600 text-gray-300 border border-gray-500'
                      }`}>
                        {isActive ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                        {isActive ? 'Active' : 'Free'}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="px-3 py-1 rounded-full text-sm font-medium w-fit bg-blue-900 text-blue-300 border border-blue-600">
                        {projectConfig.emoji} {projectConfig.name}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="font-medium">
                        <div className="text-white font-mono">{creative.creative}</div>
                        <div className="text-sm text-gray-400">
                          {creative.creative.includes('.mp4') ? '🎥 Video' : '🎨 Creative'}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      {isActive ? (
                        <div className={`font-mono text-lg font-bold ${creative.currentUsers > 5 ? 'text-green-400' : creative.currentUsers > 2 ? 'text-yellow-400' : 'text-gray-400'}`}>
                          {creative.currentUsers}
                        </div>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className={`font-mono ${performanceColor}`}>
                        {creative.totalUsers.toLocaleString()}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="space-y-1">
                        {creative.currentAccounts.slice(0, 2).map(accInfo => (
                          <span key={accInfo.account} className="inline-block px-2 py-1 rounded text-xs mr-1 mb-1 bg-gray-600 text-gray-300">
                            {accInfo.account.length > 10 ? accInfo.account.substring(0, 10) + '...' : accInfo.account} ({accInfo.users})
                          </span>
                        ))}
                        {creative.currentAccounts.length > 2 && (
                          <span className="text-gray-400 text-xs">
                            +{creative.currentAccounts.length - 2} more
                          </span>
                        )}
                        {creative.currentAccounts.length === 0 && (
                          <span className="text-gray-500 text-sm">Not active</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 font-mono">{creative.daysActive}</td>
                    <td className="p-4 font-mono">{creative.avgUsersPerDay}</td>
                    <td className="p-4 font-mono">{creative.accounts.length}</td>
                    <td className="p-4">
                      <div className={`px-3 py-1 rounded-full text-sm font-medium w-fit ${
                        creative.performance === 'high' ? 'bg-green-900 text-green-300' :
                        creative.performance === 'medium' ? 'bg-yellow-900 text-yellow-300' :
                        'bg-red-900 text-red-300'
                      }`}>
                        {creative.performance === 'high' ? '🔥 High' :
                         creative.performance === 'medium' ? '📈 Medium' :
                         '📉 Low'}
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
        <div className="text-center py-12">
          <Eye className="w-16 h-16 text-gray-500 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">No creatives found</p>
          <p className="text-gray-500 text-sm">Try changing your search filters</p>
        </div>
      )}
    </div>
  );
}

export default App;
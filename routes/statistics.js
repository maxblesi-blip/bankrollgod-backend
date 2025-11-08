// Statistics.jsx - Statistiken mit Backend-Integration
// Nutzt Backend-API für zuverlässige Berechnungen

import React, { useState, useEffect } from 'react';
import { bankrollAPI } from '../services/api';
import './Statistics.css';

// Hilfsfunktion für Währungsformatierung
const formatCurrency = (amount, currency = 'EUR') => {
  const formatter = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return formatter.format(amount);
};

// Hilfsfunktion für Zeitformatierung
const formatDuration = (minutes) => {
  if (!minutes || minutes === 0) return '0h 0m';
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  
  return `${hours}h ${remainingMinutes}m`;
};

// Hilfsfunktion für Prozent-Formatierung
const formatPercent = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '0.00%';
  return `${Number(value).toFixed(2)}%`;
};

const Statistics = () => {
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'cashgames', 'tournaments'
  const [selectedBankroll, setSelectedBankroll] = useState(null);
  const [bankrolls, setBankrolls] = useState([]);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Bankrolls beim Mount laden
  useEffect(() => {
    loadBankrolls();
  }, []);

  // Stats laden wenn Bankroll oder Filter sich ändern
  useEffect(() => {
    if (selectedBankroll) {
      loadStatistics();
    }
  }, [selectedBankroll, activeFilter]);

  const loadBankrolls = async () => {
    setIsLoading(true);
    try {
      const bankrollsData = await bankrollAPI.getAll();
      setBankrolls(Array.isArray(bankrollsData) ? bankrollsData : []);
    } catch (err) {
      console.error('Error loading bankrolls:', err);
      setError('Fehler beim Laden der Bankrolls');
    } finally {
      setIsLoading(false);
    }
  };

  const loadStatistics = async () => {
    if (!selectedBankroll?.id) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `https://bankrollgod-backend.onrender.com/api/statistics/bankroll/${selectedBankroll.id}?filter=${activeFilter}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        setStats(result.data.statistics);
        console.log('📊 Statistics loaded from backend:', result.data);
      } else {
        throw new Error(result.message || 'Failed to load statistics');
      }
    } catch (err) {
      console.error('Error loading statistics:', err);
      setError('Fehler beim Laden der Statistiken: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBankrollSelect = (bankroll) => {
    setSelectedBankroll(bankroll);
  };

  const handleFilterChange = (filter) => {
    setActiveFilter(filter);
  };

  // Wenn keine Bankroll ausgewählt ist, zeige Auswahl
  if (!selectedBankroll && bankrolls.length > 0 && !isLoading) {
    return (
      <div className="statistics-section">
        <h2 style={{ 
          color: 'var(--accent-gold)', 
          marginBottom: '1.5rem',
          fontSize: '2rem',
          textAlign: 'center'
        }}>
          Statistiken
        </h2>
        
        <div className="bankroll-selection-prompt">
          <h3>Wähle eine Bankroll für detaillierte Statistiken</h3>
          
          <div className="bankroll-quick-select">
            {bankrolls.map(bankroll => (
              <button
                key={bankroll.id}
                className="bankroll-select-btn"
                onClick={() => handleBankrollSelect(bankroll)}
              >
                <span className="bankroll-icon">
                  {bankroll.type === 'online' ? '💻' : '🏢'}
                </span>
                <span className="bankroll-name">{bankroll.name}</span>
                <span className="bankroll-amount">
                  {formatCurrency(bankroll.current_amount, bankroll.currency)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Loading State
  if (isLoading) {
    return (
      <div className="statistics-section">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Lade Statistiken...</p>
        </div>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="statistics-section">
        <div className="error-message">
          <span>⚠️</span>
          <span>{error}</span>
          <button 
            onClick={loadStatistics}
            style={{
              marginLeft: 'auto',
              background: 'var(--accent-red)',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  const currency = selectedBankroll?.currency || 'EUR';

  return (
    <div className="statistics-section">
      {/* Header mit Bankroll-Info und Zurück-Button */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '2rem'
      }}>
        <h2 style={{ 
          color: 'var(--accent-gold)', 
          margin: 0,
          fontSize: '2rem'
        }}>
          Statistiken
        </h2>
        
        {selectedBankroll && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            background: 'var(--bg-card)',
            padding: '0.75rem 1.25rem',
            borderRadius: '12px',
            border: '1px solid var(--border-color)'
          }}>
            <span style={{ fontSize: '1.25rem' }}>
              {selectedBankroll.type === 'online' ? '💻' : '🏢'}
            </span>
            <div>
              <div style={{ 
                color: 'var(--text-secondary)', 
                fontSize: '0.85rem',
                marginBottom: '0.25rem'
              }}>
                Detaillierte Performance-Analyse für
              </div>
              <div style={{ 
                color: 'var(--accent-gold)', 
                fontWeight: 600,
                fontSize: '1.1rem'
              }}>
                {selectedBankroll.name}
              </div>
            </div>
            <button
              onClick={() => setSelectedBankroll(null)}
              style={{
                background: 'transparent',
                border: '1px solid var(--primary-green)',
                color: 'var(--primary-green)',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.9rem',
                marginLeft: '1rem',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontWeight: 600
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'var(--primary-green)';
                e.currentTarget.style.color = 'white';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--primary-green)';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
              </svg>
              Zurück
            </button>
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="statistics-filters">
        <button
          className={`filter-tab ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => handleFilterChange('all')}
        >
          Alle
        </button>
        <button
          className={`filter-tab ${activeFilter === 'cashgames' ? 'active' : ''}`}
          onClick={() => handleFilterChange('cashgames')}
        >
          Cashgames
        </button>
        <button
          className={`filter-tab ${activeFilter === 'tournaments' ? 'active' : ''}`}
          onClick={() => handleFilterChange('tournaments')}
        >
          Turniere
        </button>
      </div>

      {/* Hauptstatistik */}
      {stats && (
        <>
          <div className="main-statistic">
            <div className="main-stat-card">
              <h3>Gesamtgewinn</h3>
              <div 
                className="main-stat-value"
                style={{ 
                  color: (stats.totalProfit || 0) >= 0 ? 'var(--light-green)' : 'var(--accent-red)' 
                }}
              >
                {(stats.totalProfit || 0) >= 0 ? '+' : ''}
                {formatCurrency(stats.totalProfit || 0, currency)}
              </div>
            </div>
          </div>

          {/* Statistik Grid basierend auf aktivem Filter */}
          {activeFilter === 'all' && (
            <div className="statistics-grid">
              <div className="stat-card">
                <div className="stat-label">Durchschnittlicher Gewinn / Stunde</div>
                <div 
                  className="stat-value"
                  style={{
                    color: (stats.avgProfitPerHour || 0) >= 0 ? 'var(--light-green)' : 'var(--accent-red)'
                  }}
                >
                  {(stats.avgProfitPerHour || 0) >= 0 ? '+' : ''}
                  {formatCurrency(stats.avgProfitPerHour || 0, currency)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Durchschnittlicher Gewinn / Session</div>
                <div 
                  className="stat-value"
                  style={{
                    color: (stats.avgProfitPerSession || 0) >= 0 ? 'var(--light-green)' : 'var(--accent-red)'
                  }}
                >
                  {(stats.avgProfitPerSession || 0) >= 0 ? '+' : ''}
                  {formatCurrency(stats.avgProfitPerSession || 0, currency)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Gesamte Spielzeit</div>
                <div className="stat-value">
                  {formatDuration(stats.totalPlaytime || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">ROI</div>
                <div 
                  className="stat-percentage"
                  style={{
                    color: (stats.totalROI || 0) >= 0 ? 'var(--light-green)' : 'var(--accent-red)'
                  }}
                >
                  {(stats.totalROI || 0) >= 0 ? '+' : ''}
                  {formatPercent(stats.totalROI || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Gesamtkosten</div>
                <div className="stat-value">
                  {formatCurrency(stats.totalCosts || 0, currency)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Gesamte Sessions</div>
                <div className="stat-value">
                  {stats.totalSessions || 0}
                </div>
              </div>
            </div>
          )}

          {activeFilter === 'cashgames' && (
            <div className="statistics-grid">
              <div className="stat-card">
                <div className="stat-label">Gesamte Sitzungen</div>
                <div className="stat-value">
                  {stats.totalSessions || 0}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Gesamte Spielzeit</div>
                <div className="stat-value">
                  {formatDuration(stats.totalPlaytime || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Durchschnittlicher Gewinn / Stunde</div>
                <div 
                  className="stat-value"
                  style={{
                    color: (stats.avgProfitPerHour || 0) >= 0 ? 'var(--light-green)' : 'var(--accent-red)'
                  }}
                >
                  {(stats.avgProfitPerHour || 0) >= 0 ? '+' : ''}
                  {formatCurrency(stats.avgProfitPerHour || 0, currency)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Durchschnittlicher Gewinn / Sitzung</div>
                <div 
                  className="stat-value"
                  style={{
                    color: (stats.avgProfitPerSession || 0) >= 0 ? 'var(--light-green)' : 'var(--accent-red)'
                  }}
                >
                  {(stats.avgProfitPerSession || 0) >= 0 ? '+' : ''}
                  {formatCurrency(stats.avgProfitPerSession || 0, currency)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">ROI</div>
                <div 
                  className="stat-percentage"
                  style={{
                    color: (stats.totalROI || 0) >= 0 ? 'var(--light-green)' : 'var(--accent-red)'
                  }}
                >
                  {(stats.totalROI || 0) >= 0 ? '+' : ''}
                  {formatPercent(stats.totalROI || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Gesamte Buy Ins</div>
                <div className="stat-value">
                  {formatCurrency(stats.totalBuyIns || 0, currency)}
                </div>
              </div>
            </div>
          )}

          {activeFilter === 'tournaments' && (
            <div className="statistics-grid">
              <div className="stat-card">
                <div className="stat-label">Turniere Insgesamt</div>
                <div className="stat-value">
                  {stats.totalTournaments || 0}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Gesamte Turnier-Einträge</div>
                <div className="stat-value">
                  {stats.totalEntries || 0}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Gesamte Spielzeit</div>
                <div className="stat-value">
                  {formatDuration(stats.totalPlaytime || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">ITM-Verhältnis</div>
                <div className="stat-percentage" style={{ color: 'var(--light-green)' }}>
                  {formatPercent(stats.itmRatio || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Total ROI</div>
                <div 
                  className="stat-percentage"
                  style={{
                    color: (stats.totalROI || 0) >= 0 ? 'var(--light-green)' : 'var(--accent-red)'
                  }}
                >
                  {(stats.totalROI || 0) >= 0 ? '+' : ''}
                  {formatPercent(stats.totalROI || 0)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Durchschnittliche Buy Ins</div>
                <div className="stat-value">
                  {formatCurrency(stats.avgBuyIn || 0, currency)}
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Gesamte Buy Ins</div>
                <div className="stat-value">
                  {formatCurrency(stats.totalBuyIns || 0, currency)}
                </div>
              </div>
            </div>
          )}

          {/* Zusätzliche Statistik-Sektionen */}
          <div className="additional-stats">
            <div className="stat-section">
              <button className="stat-section-btn">
                <span>Statistiken von Woche</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                </svg>
              </button>
            </div>

            <div className="stat-section">
              <button className="stat-section-btn">
                <span>Statistiken von Monat</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                </svg>
              </button>
            </div>

            <div className="stat-section">
              <button className="stat-section-btn">
                <span>Statistiken von Spiel</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                </svg>
              </button>
            </div>

            <div className="stat-section">
              <button className="stat-section-btn">
                <span>Statistiken von Buyin</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                </svg>
              </button>
            </div>

            <div className="stat-section">
              <button className="stat-section-btn">
                <span>Statistiken von Ort</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Statistics;
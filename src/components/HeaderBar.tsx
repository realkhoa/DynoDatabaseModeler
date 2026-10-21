/**
 * @file HeaderBar.tsx
 * @brief Modern top header navigation, status bar, and theme switcher component.
 * @details Houses workspace navigation tabs (ERD Canvas, SQL Query, Settings),
 * active connection status badge, quick theme switcher dropdown, and disconnect / connection triggers.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  GitGraph,
  Code,
  Settings,
  Unplug,
  Plus,
  GitCompare,
  Activity,
  Sun,
  Moon,
  Check,
  PanelLeft,
} from 'lucide-react';
import type { ConnectionConfig } from '../types/database';
import type { AppTheme } from '../types/theme';
import { THEMES } from '../types/theme';
import { getSavedTheme, setSavedTheme, applyTheme, onThemeChange } from '../utils/themeManager';

/**
 * @brief Tab identifier types available in DynoDbModeler workspace.
 */
export type WorkspaceTab = 'erd' | 'sql' | 'query' | 'settings';

/**
 * @brief Properties accepted by the HeaderBar component.
 */
export interface HeaderBarProps {
  /** @brief Currently selected active navigation tab. */
  activeTab: WorkspaceTab;
  /** @brief Callback triggered when user clicks a navigation tab. */
  onSelectTab: (tab: WorkspaceTab) => void;
  /** @brief Currently active database connection configuration or null if disconnected. */
  activeConnection: ConnectionConfig | null;
  /** @brief Callback triggered when user requests disconnecting the active session. */
  onDisconnect?: () => void;
  /** @brief Callback triggered to open the new connection modal dialog. */
  onOpenNewConnection: () => void;
  /** @brief Optional callback triggered to review schema diff and sync migrations. */
  onOpenDiff?: () => void;
  /** @brief Number of detected pending structural schema changes between live and desired schemas. */
  pendingChangesCount?: number;
  /** @brief Optional callback triggered to open the active database processes and query monitor. */
  onOpenProcesses?: () => void;
  /** @brief Currently selected application visual theme. */
  currentTheme?: AppTheme;
  /** @brief Callback triggered when a new visual theme is selected. */
  onSelectTheme?: (theme: AppTheme) => void;
  /** @brief Current mode of the navigation sidebar ('expanded', 'rail', or 'zen'). */
  sidebarMode?: 'expanded' | 'rail' | 'zen';
  /** @brief Callback triggered when user clicks the sidebar toggle button. */
  onToggleSidebar?: () => void;
}

/**
 * @brief Modern dark-themed header bar displaying application tabs, connection telemetry, and theme switcher.
 * @details Features a minimalist 40px flat height, micro-status connection dot, quick theme popover,
 * and collapsible sidebar toggle button.
 * @param props Component properties configuring active tabs, connection state, sidebar toggle, and theme controls.
 * @return Rendered HeaderBar element.
 */
export const HeaderBar: React.FC<HeaderBarProps> = React.memo(({
  activeTab,
  onSelectTab,
  activeConnection,
  onDisconnect,
  onOpenNewConnection,
  onOpenDiff,
  pendingChangesCount = 0,
  onOpenProcesses,
  currentTheme,
  onSelectTheme,
  sidebarMode: _sidebarMode,
  onToggleSidebar,
}) => {
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [activeTheme, setActiveTheme] = useState<AppTheme>(currentTheme || getSavedTheme());
  const themeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentTheme) {
      setActiveTheme(currentTheme);
    }
  }, [currentTheme]);

  useEffect(() => {
    const unsub = onThemeChange((t) => {
      setActiveTheme(t);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target as Node)) {
        setIsThemeOpen(false);
      }
    };
    if (isThemeOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isThemeOpen]);

  /**
   * @brief Handles selecting a new visual theme from the popover menu.
   * @param theme Target theme to activate.
   */
  const handlePickTheme = (theme: AppTheme) => {
    setActiveTheme(theme);
    setSavedTheme(theme);
    applyTheme(theme);
    onSelectTheme?.(theme);
    setIsThemeOpen(false);
  };

  /**
   * @brief Renders the dynamic icon reflecting the currently active theme.
   * @return React icon element.
   */
  const renderThemeIcon = () => {
    if (activeTheme === 'gitingest') return <Sun className="w-3.5 h-3.5 text-amber-500" />;
    if (activeTheme === 'github-light') return <Sun className="w-3.5 h-3.5 text-blue-500" />;
    if (activeTheme === 'midnight') return <Moon className="w-3.5 h-3.5 text-cyan-400" />;
    return <Moon className="w-3.5 h-3.5 text-[#8c919a]" />;
  };

  return (
    <header className="h-10 bg-[#18191c] border-b border-[#35373c] flex items-center justify-between px-3 select-none shrink-0 text-xs">
      {/* Brand & Logo with Sidebar Toggle */}
      <div className="flex items-center space-x-2 mr-4">
        {onToggleSidebar && (
          <button
            type="button"
            data-testid="header-sidebar-toggle-btn"
            onClick={onToggleSidebar}
            title="Toggle Sidebar (Ctrl+B)"
            className="p-1 rounded text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#24262b] cursor-pointer"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        <img
          src="/icon.png"
          alt="DynoDbModeler Logo"
          className="w-5 h-5 rounded-md shadow-xs object-contain"
        />
        <span className="font-semibold text-sm text-[#e6e8ea] tracking-tight">
          DynoDbModeler
        </span>
      </div>

      {/* Navigation Tabs */}
      <nav aria-label="Main Navigation" className="flex items-center space-x-1">
        <button
          type="button"
          onClick={() => onSelectTab('erd')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded transition-colors cursor-pointer ${
            activeTab === 'erd'
              ? 'bg-[#2b2d30] text-[#ffffff] font-medium shadow-xs border-b-2 border-[#3a82f7]'
              : 'text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#222428]'
          }`}
        >
          <GitGraph className="w-3.5 h-3.5" />
          <span>ERD Canvas</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('sql')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded transition-colors cursor-pointer ${
            activeTab === 'sql' || activeTab === 'query'
              ? 'bg-[#2b2d30] text-[#ffffff] font-medium shadow-xs border-b-2 border-[#3a82f7]'
              : 'text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#222428]'
          }`}
        >
          <Code className="w-3.5 h-3.5" />
          <span>SQL Query</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('settings')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded transition-colors cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-[#2b2d30] text-[#ffffff] font-medium shadow-xs border-b-2 border-[#3a82f7]'
              : 'text-[#8c919a] hover:text-[#e6e8ea] hover:bg-[#222428]'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </button>
      </nav>

      {/* Connection Status, Actions & Theme Switcher */}
      <div className="flex items-center space-x-2 ml-auto">
        {/* Theme Switcher Popover */}
        <div className="relative" ref={themeMenuRef}>
          <button
            type="button"
            data-testid="header-theme-switcher-btn"
            onClick={() => setIsThemeOpen((prev) => !prev)}
            className="flex items-center space-x-1.5 px-2 py-0.5 bg-[#24262b] hover:bg-[#2f3238] border border-[#35373c] text-[#e6e8ea] rounded font-medium shadow-xs transition-colors cursor-pointer"
            title={`Theme: ${THEMES[activeTheme]?.label || 'Theme'}`}
          >
            {renderThemeIcon()}
            <span className="hidden sm:inline text-[11px] font-normal">{THEMES[activeTheme]?.label || 'Theme'}</span>
          </button>

          {isThemeOpen && (
            <div
              data-testid="header-theme-dropdown"
              className="absolute right-0 mt-1.5 w-52 bg-[#1e1f22] border border-[#35373c] rounded-lg shadow-xl p-1.5 z-50 space-y-1"
            >
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#8c919a] border-b border-[#35373c]/50 mb-1">
                Appearance / Theme
              </div>
              {(Object.keys(THEMES) as AppTheme[]).map((tId) => {
                const meta = THEMES[tId];
                const isSelected = activeTheme === tId;
                return (
                  <button
                    key={tId}
                    type="button"
                    data-testid={`theme-option-${tId}`}
                    onClick={() => handlePickTheme(tId)}
                    className={`flex items-center justify-between w-full px-2 py-1.5 rounded text-left transition-colors cursor-pointer text-xs ${
                      isSelected
                        ? 'bg-[#2b2d30] text-white font-medium'
                        : 'text-[#e6e8ea] hover:bg-[#26282d]'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-[#35373c] shrink-0"
                        style={{ backgroundColor: meta.previewColor }}
                      />
                      <div>
                        <div className="leading-tight">{meta.label}</div>
                        <div className="text-[10px] text-[#8c919a] font-normal">{meta.description}</div>
                      </div>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#3a82f7] shrink-0 ml-1.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {activeConnection ? (
          <div className="flex items-center space-x-2">
            {onOpenDiff && (
              <button
                type="button"
                onClick={onOpenDiff}
                className="flex items-center space-x-1.5 px-2.5 py-0.5 bg-[#24262b] hover:bg-[#2f3238] border border-[#35373c] text-[#e6e8ea] rounded font-medium shadow-xs transition-colors cursor-pointer"
                title="Review schema differences and synchronize migrations"
              >
                <GitCompare className="w-3.5 h-3.5 text-[#3a82f7]" />
                <span>Review &amp; Sync</span>
                {pendingChangesCount > 0 && (
                  <span
                    data-testid="pending-changes-badge"
                    className="ml-1 px-1.5 py-0.2 rounded-full bg-[#3a82f7] text-white text-[10px] font-bold"
                  >
                    {pendingChangesCount}
                  </span>
                )}
              </button>
            )}

            {onOpenProcesses && (
              <button
                type="button"
                data-testid="header-processes-btn"
                onClick={onOpenProcesses}
                className="flex items-center space-x-1.5 px-2.5 py-0.5 bg-[#24262b] hover:bg-[#2f3238] border border-[#35373c] text-[#e6e8ea] rounded font-medium shadow-xs transition-colors cursor-pointer"
                title="Active database processes & query monitor"
              >
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span>Processes</span>
              </button>
            )}

            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-[#24262b] border border-[#35373c] text-[11px] font-mono">
              <span
                data-testid="header-connection-status-dot"
                className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
                title="Connected"
              />
              <span className="font-medium text-[#e6e8ea] truncate max-w-[140px]">
                {activeConnection.name || activeConnection.database}
              </span>
              {activeConnection.db_type && (
                <span className="text-[10px] uppercase font-mono px-1 rounded bg-[#2b2d30] text-[#8c919a]">
                  {activeConnection.db_type}
                </span>
              )}
              {onDisconnect && (
                <button
                  type="button"
                  onClick={onDisconnect}
                  title="Disconnect from database"
                  aria-label="Disconnect database"
                  className="p-1 hover:bg-[#35373c] text-[#8c919a] hover:text-red-400 rounded transition-colors ml-1 cursor-pointer"
                >
                  <Unplug className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1.5 text-[#8c919a] px-2 py-0.5 text-[11px] font-mono">
              <span
                data-testid="header-connection-status-dot"
                className="w-2 h-2 rounded-full bg-[#8c919a]"
                title="Disconnected"
              />
              <span>Disconnected</span>
            </div>
            <button
              type="button"
              onClick={onOpenNewConnection}
              className="flex items-center space-x-1 px-2.5 py-0.5 bg-[#3a82f7] hover:bg-[#2f6fd6] text-white rounded font-medium shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Connect</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
});
HeaderBar.displayName = 'HeaderBar';

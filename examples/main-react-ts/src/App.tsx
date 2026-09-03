import { CaretUpOutlined, UnorderedListOutlined } from '@ant-design/icons';
import Button from 'antd/es/button';
import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import All from './pages/All';
import Angular12 from './pages/Angular12';
import Home from './pages/Home';
import React16 from './pages/React16';
import React17 from './pages/React17';
import Vite from './pages/Vite';
import Vue2 from './pages/Vue2';
import Vue3 from './pages/Vue3';
import WujieReact from './wujieReact';

const { bus } = WujieReact;

const subRoutes = {
  react16: ['home', 'dialog', 'location', 'communication', 'nest', 'font'],
  react17: ['home', 'dialog', 'location', 'communication', 'state'],
  vue2: ['home', 'dialog', 'location', 'communication'],
  vue3: ['home', 'dialog', 'location', 'contact', 'state', 'inline-event'],
  vite: ['home', 'dialog', 'location', 'contact'],
} as const;

type ExpandableApp = keyof typeof subRoutes;
type OpenMenus = Record<ExpandableApp, boolean>;

interface NavigationProps {
  onOpen: () => void;
}

function Navigation({ onOpen }: NavigationProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [openMenus, setOpenMenus] = useState<OpenMenus>({
    react16: location.pathname.includes('react16-sub'),
    react17: location.pathname.includes('react17-sub'),
    vue2: location.pathname.includes('vue2-sub'),
    vue3: location.pathname.includes('vue3-sub'),
    vite: location.pathname.includes('vite-sub'),
  });
  const supportsAdvancedMode = typeof Proxy !== 'undefined';

  useEffect(() => {
    const handleSubRouteChange = (name: string, path: string): void => {
      const mainName = `${name}-sub`;
      const mainPath = `/${mainName}${path}`;
      const currentPath = window.location.hash.replace('#', '');

      if (currentPath.includes(mainName) && currentPath !== mainPath) {
        void navigate(mainPath);
      }
    };

    bus.$on<[name: string, path: string]>('sub-route-change', handleSubRouteChange);
    return () => {
      bus.$off<[name: string, path: string]>('sub-route-change', handleSubRouteChange);
    };
  }, [navigate]);

  const toggleMenu = (name: ExpandableApp): void => {
    setOpenMenus((current) => ({ ...current, [name]: !current[name] }));
  };

  const renderExpandableLink = (name: ExpandableApp, label: string, alive = false) => (
    <>
      <NavLink to={`/${name}`} className={({ isActive }) => (isActive ? 'active' : 'inactive')}>
        {label}
        {alive && <span className="alive">保活</span>}
        <CaretUpOutlined
          className={openMenus[name] ? 'main-icon active' : 'main-icon'}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleMenu(name);
          }}
        />
      </NavLink>
      <div className="sub-menu" style={{ display: openMenus[name] ? 'block' : 'none' }}>
        {subRoutes[name].map((item) => (
          <NavLink
            to={`/${name}-sub/${item}`}
            key={item}
            className={({ isActive }) => (isActive ? 'active' : 'inactive')}
          >
            {item}
          </NavLink>
        ))}
      </div>
    </>
  );

  return (
    <nav>
      <NavLink to="/home" className={({ isActive }) => (isActive ? 'active' : 'inactive')}>
        介绍
      </NavLink>
      {renderExpandableLink('react16', 'react16')}
      {renderExpandableLink('react17', 'react17', true)}
      {renderExpandableLink('vue2', 'vue2')}
      {supportsAdvancedMode && renderExpandableLink('vue3', 'vue3', true)}
      {supportsAdvancedMode && renderExpandableLink('vite', 'vite')}
      <NavLink to="/angular12" className={({ isActive }) => (isActive ? 'active' : 'inactive')}>
        angular12
      </NavLink>
      <NavLink to="/all" className={({ isActive }) => (isActive ? 'active' : 'inactive')}>
        all
      </NavLink>
      <Button
        type="primary"
        className="menu-icon"
        aria-label="打开导航菜单"
        icon={<UnorderedListOutlined />}
        onClick={onOpen}
      />
    </nav>
  );
}

export default function App() {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className="app">
      <HashRouter>
        <div className={navigationOpen ? 'nav active' : 'nav'}>
          <Navigation onOpen={() => setNavigationOpen(true)} />
        </div>
        <main className="content" onClick={() => setNavigationOpen(false)}>
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/react16" element={<React16 />} />
            <Route path="/react16-sub/:path" element={<React16 />} />
            <Route path="/react17" element={<React17 />} />
            <Route path="/react17-sub/:path" element={<React17 />} />
            <Route path="/vue2" element={<Vue2 />} />
            <Route path="/vue2-sub/:path" element={<Vue2 />} />
            <Route path="/vue3" element={<Vue3 />} />
            <Route path="/vue3-sub/:path" element={<Vue3 />} />
            <Route path="/vite" element={<Vite />} />
            <Route path="/vite-sub/:path" element={<Vite />} />
            <Route path="/angular12" element={<Angular12 />} />
            <Route path="/all" element={<All />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </main>
      </HashRouter>
    </div>
  );
}

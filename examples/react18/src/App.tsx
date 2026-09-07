import { useEffect, useRef } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Home from './pages/Home';
import Dialog from './pages/Dialog';
import Location from './pages/Location';
import Communication from './pages/Communication';
import State from './pages/State';

const Navigation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const ready = useRef(false);

  useEffect(() => {
    const bus = window.$jieshu?.bus;
    const changeRoute = (path: string) => {
      const currentPath = `/${window.location.pathname.slice(import.meta.env.BASE_URL.length)}`;
      if (currentPath !== path) {
        // 主应用已经创建历史记录，同步指令只替换子应用路由，避免前进后退产生重复记录。
        void navigate(path, { replace: true });
      }
    };
    bus?.$on('react18-router-change', changeRoute);
    if (!ready.current) {
      ready.current = true;
      bus?.$emit('react18-router-ready');
    }
    return () => {
      bus?.$off('react18-router-change', changeRoute);
    };
  }, [navigate]);

  useEffect(() => {
    window.$jieshu?.bus.$emit('sub-route-change', 'react18', location.pathname);
    console.log(`react18 ${location.pathname.slice(1)} mounted`);
  }, [location.pathname]);

  return (
    <nav aria-label="React18 子应用导航" className="react18-nav">
      <NavLink to="/home" replace={Boolean(window.$jieshu?.props?.route)}>
        首页
      </NavLink>
      <NavLink to="/dialog" replace={Boolean(window.$jieshu?.props?.route)}>
        弹窗
      </NavLink>
      <NavLink to="/location" replace={Boolean(window.$jieshu?.props?.route)}>
        路由
      </NavLink>
      <NavLink to="/communication" replace={Boolean(window.$jieshu?.props?.route)}>
        通信
      </NavLink>
      <NavLink to="/state" replace={Boolean(window.$jieshu?.props?.route)}>
        状态
      </NavLink>
    </nav>
  );
};

const App = () => (
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <main className="react18-app">
      <h1>React18 子应用</h1>
      <Navigation />
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/dialog" element={<Dialog />} />
        <Route path="/location" element={<Location />} />
        <Route path="/communication" element={<Communication />} />
        <Route path="/state" element={<State />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </main>
  </BrowserRouter>
);

export default App;

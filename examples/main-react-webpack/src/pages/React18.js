import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import hostMap from '../hostMap';
import JieshuReact from '@cloud/jieshu-react';
import lifecycles from '../lifecycle';

const React18 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname.startsWith('/react18-sub/') ? location.pathname.slice('/react18-sub'.length) : '';
  const syncRoute = () => {
    if (path) {
      JieshuReact.bus.$emit('react18-router-change', path);
    }
  };
  useEffect(() => {
    const ready = () => {
      if (path) {
        JieshuReact.bus.$emit('react18-router-change', path);
      }
    };
    JieshuReact.bus.$on('react18-router-ready', ready);
    ready();
    return () => {
      JieshuReact.bus.$off('react18-router-ready', ready);
    };
  }, [path]);

  const props = {
    route: path,
    jump: (name) => {
      void navigate(`/${name}`);
    },
  };

  return (
    <JieshuReact
      width="100%"
      height="100%"
      name="react18"
      url={hostMap('//localhost:7900/') + path.slice(1)}
      alive
      sync={!path}
      props={props}
      activated={(appWindow) => {
        lifecycles.activated(appWindow);
        syncRoute();
      }}
    />
  );
};

export default React18;

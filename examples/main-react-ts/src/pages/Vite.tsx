import { useLocation, useNavigate } from 'react-router-dom';

import hostMap from '../hostMap';
import WujieReact from '../wujieReact';

export default function Vite() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname.replace('/vite-sub', '').replace('/vite', '').replace('/', '');
  const viteUrl = hostMap('//localhost:7500/') + path;
  const props = {
    jump: (name: string): void => {
      void navigate(`/${name}`);
    },
  };

  return <WujieReact width="100%" height="100%" name="vite" url={viteUrl} sync={!path} props={props} />;
}

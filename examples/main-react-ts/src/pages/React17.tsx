import { useLocation, useNavigate } from 'react-router-dom';

import hostMap from '../hostMap';
import WujieReact from '../wujieReact';

export default function React17() {
  const location = useLocation();
  const navigate = useNavigate();
  const react17Url = hostMap('//localhost:7100/');
  const path = location.pathname.replace('/react17-sub', '').replace('/react17', '');

  if (path) {
    WujieReact.bus.$emit<[path: string]>('react17-router-change', path);
  }

  const props = {
    jump: (name: string): void => {
      void navigate(`/${name}`);
    },
  };

  return <WujieReact width="100%" height="100%" name="react17" url={react17Url} sync={!path} props={props} />;
}

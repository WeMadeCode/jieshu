import { useLocation, useNavigate } from 'react-router-dom';

import hostMap from '../hostMap';
import WujieReact from '../wujieReact';

export default function Vue3() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname.replace('/vue3-sub', '').replace('/vue3', '');
  const vue3Url = hostMap('//localhost:7300/');

  if (path) {
    WujieReact.bus.$emit<[path: string]>('vue3-router-change', path);
  }

  const props = {
    jump: (name: string): void => {
      void navigate(`/${name}`);
    },
  };

  return <WujieReact width="100%" height="100%" name="vue3" url={vue3Url} sync={!path} props={props} />;
}

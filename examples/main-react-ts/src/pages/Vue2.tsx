import { useLocation, useNavigate } from 'react-router-dom';

import hostMap from '../hostMap';
import WujieReact from '../wujieReact';

export default function Vue2() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname.replace('/vue2-sub', '').replace('/vue2', '');
  const vue2Url = `${hostMap('//localhost:7200/')}#${path}`;
  const props = {
    jump: (name: string): void => {
      void navigate(`/${name}`);
    },
  };

  return <WujieReact width="100%" height="100%" name="vue2" url={vue2Url} sync={!path} props={props} />;
}

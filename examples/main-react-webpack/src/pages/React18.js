import { useNavigate } from 'react-router-dom';
import hostMap from '../hostMap';
import JieshuReact from '@cloud/jieshu-react';

const React18 = () => {
  const navigate = useNavigate();
  const props = {
    jump: (name) => {
      void navigate(`/${name}`);
    },
  };

  return (
    <JieshuReact width="100%" height="100%" name="react18" url={hostMap('//localhost:7900/')} sync props={props} />
  );
};

export default React18;

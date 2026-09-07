import { useNavigate } from 'react-router-dom';
import JieshuReact from '@cloud/jieshu-react';

import lifecycles from '../lifecycle';

const Custom = () => {
  const navigate = useNavigate();
  const props = {
    jump: (name: string) => {
      void navigate(`/${name}`);
    },
  };

  return (
    <JieshuReact
      width="100%"
      height="100%"
      name="custom"
      url="http://localhost:9010/"
      sync
      props={props}
      {...lifecycles}
    />
  );
};

export default Custom;

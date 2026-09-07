import Button from 'antd/es/button';
import { useLocation, useNavigate } from 'react-router-dom';

const Location = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const appLocation = window.$jieshu?.location ?? window.location;

  return (
    <section>
      <h2>路由处理</h2>
      <h3>1、路由同步</h3>
      <p>子应用路由同步到主应用 URL 的 react18 参数；刷新、前进、后退均可恢复当前路由。</p>
      <p>从主应用展开 React18 子菜单进入时，子应用导航会同步更新主应用菜单。</p>
      <p>
        当前子路由：
        <output data-testid="child-location">
          {location.pathname}
          {location.search}
          {location.hash}
        </output>
      </p>
      <div className="actions">
        <Button onClick={() => navigate('/location?from=react18#detail')}>添加 query 和 hash</Button>
        <Button onClick={() => navigate('/home')}>跳转首页</Button>
        <Button onClick={() => navigate(-1)}>后退</Button>
        <Button onClick={() => navigate(1)}>前进</Button>
      </div>
      <h3>2、location 劫持</h3>
      <p>
        Vite 使用 module 脚本，window.location 是 iframe 的原生地址；使用 $jieshu.location
        读取和修改子应用地址。独立运行时使用 window.location。
      </p>
      <dl>
        <dt>host</dt>
        <dd data-testid="child-host">{appLocation.host}</dd>
        <dt>href</dt>
        <dd>{appLocation.href}</dd>
      </dl>
      <h3>3、修改子应用 location.href</h3>
      <Button
        onClick={() => {
          appLocation.href = 'https://wujicode.cn/xy/app/prod/official/index';
        }}
      >
        跳转无极
      </Button>
      <p>跳转外部页面时，框架将当前子应用替换为 iframe；开启路由同步时可通过浏览器后退返回。</p>
    </section>
  );
};

export default Location;

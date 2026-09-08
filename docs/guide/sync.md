# 路由同步

## 路由同步

路由同步会将子应用路径的`path+query+hash`通过`window.encodeURIComponent`编码后挂载在主应用`url`的查询参数上，其中`key`值为子应用的 [name](/api/startApp.html#name)。

开启路由同步后，刷新浏览器或者将`url`分享出去子应用的路由状态都不会丢失，当一个页面存在多个子应用时界枢支持所有子应用路由同步，浏览器刷新、前进、后退子应用路由状态也都不会丢失

开启参数 [sync](/api/startApp.html#sync)

::: warning 注意
只有界枢实例在初次实例化的时候才会从`url`上读回路由信息，一旦实例化完成后续只会单向的将子应用路由同步到主应用`url`上
:::

## 主应用的历史状态

同步子应用路径、关闭同步时删除参数，以及卸载或销毁时清理参数，都会保留当前主应用的 `history.state`。主路由器和业务写入的导航状态不会因此被清空，子应用自身的 `history.state` 也不会写入主应用。

这些操作只修改当前历史项的 URL，不额外新增主应用历史项。子应用自身的路由跳转仍可能产生浏览器历史记录。

子应用通过 `window.location.href` 触发框架的页面跳转时，沿用新增主应用历史项的行为：新项的 `state` 为 `null`，原历史项的状态保持不变。框架不会复制旧项的路由索引、标识或滚动记录，也不会为主路由器生成新项元数据；依赖这些元数据的导航拦截或滚动恢复不属于该跳转路径的兼容保证。

## 短路径

界枢提供短路径的能力，当子应用的`url`过长时，可以通过配置 [prefix](/api/startApp.html#prefix) 来缩短子应用同步到主应用的路径，界枢在选取短路径的时候，按照匹配最长路径原则选取短路径。

完成匹配后子应用匹配到的路径将被`{短路径} + 剩余路径`的方式挂载到主应用`url`上，注意在匹配路径的时候请不要带上域名

**示例**

```vue
<JieshuVue
  width="100%"
  height="100%"
  name="xxx"
  :url="xxx"
  :sync="true"
  :prefix="{
    prod: '/example/prod',
    test: '/example/test'
    prodId: '/example/prod/debug?id=',
  }"
></JieshuVue>
```

此时子应用不同路径将转换如下：

```
/example/prod/hello  => {prod}/hello

/example/test/name => {test}/name

/example/prod/debug?id=5&age=10 => {prodId}5&age=10
```

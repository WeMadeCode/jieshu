import {
  compactRoutePath,
  decodeRouteQuery,
  encodeRouteQuery,
  expandRoutePath,
  getAppRoute,
  readRouteState,
  writeRouteState,
} from "../../src/route-state";

describe("route-state query codec", () => {
  test("按 URLSearchParams 语义解码空值、加号和重复参数", () => {
    expect(
      decodeRouteQuery("?app=%2F%23%2Fdialog&token=%7Bprefix%7D&empty=&flag&space=a+b&duplicate=first&duplicate=last")
    ).toEqual({
      app: "/#/dialog",
      token: "{prefix}",
      empty: "",
      flag: "",
      space: "a b",
      duplicate: "last",
    });
  });

  test("写回时保持 encodeURIComponent 编码语义，空格不转换为加号", () => {
    expect(
      encodeRouteQuery({
        app: "/#/dialog",
        token: "{prefix}",
        space: "a b",
        reserved: "a+b&c=d",
      })
    ).toBe("?app=%2F%23%2Fdialog&token=%7Bprefix%7D&space=a%20b&reserved=a%2Bb%26c%3Dd");
  });

  test("应用名中的 query 分隔符会编码且原型键仍按普通 id 读写", () => {
    const query = decodeRouteQuery("?a%26b%3Dc=%2Froute&__proto__=%2Fproto&constructor=%2Fctor");

    expect(Object.getPrototypeOf(query)).toBeNull();
    expect(query["a&b=c"]).toBe("/route");
    expect(query.__proto__).toBe("/proto");
    expect(query.constructor).toBe("/ctor");
    expect(encodeRouteQuery(query)).toBe(
      "?a%26b%3Dc=%2Froute&__proto__=%2Fproto&constructor=%2Fctor"
    );
  });

  test("读写一轮不会重复编码已经编码在参数值中的百分号", () => {
    const state = readRouteState("https://host.test/shell?app=%252Fdeep#/all");
    expect(state.query.app).toBe("%2Fdeep");
    expect(writeRouteState(state)).toBe("https://host.test/shell?app=%252Fdeep#/all");
  });

  test("空参数保持既有问号行为且不吞掉主应用 hash", () => {
    expect(encodeRouteQuery({})).toBe("?");
    expect(writeRouteState(readRouteState("https://host.test/shell?old=1#/all"))).toBe(
      "https://host.test/shell?old=1#/all"
    );

    const emptyState = readRouteState("https://host.test/shell#/all");
    expect(writeRouteState(emptyState)).toBe("https://host.test/shell?#/all");
  });
});

describe("route-state prefix codec", () => {
  const prefix = {
    root: "/",
    product: "/products",
    detail: "/products/special",
  };

  test("压缩时选择最长的匹配路径", () => {
    expect(compactRoutePath("/products/special/item?q=1#intro", prefix)).toBe("{detail}/item?q=1#intro");
  });

  test("相同长度的路径使用配置中的第一个匹配项", () => {
    expect(compactRoutePath("/same/item", { first: "/same", second: "/same" })).toBe("{first}/item");
  });

  test("没有匹配项时保持原路径", () => {
    expect(compactRoutePath("settings", { home: "/home" })).toBe("settings");
  });

  test("展开已知短路径，普通路径保持原值", () => {
    expect(expandRoutePath("{detail}/item?q=1#intro", prefix)).toBe("/products/special/item?q=1#intro");
    expect(expandRoutePath("/plain", prefix)).toBe("/plain");
    expect(expandRoutePath("{unknown}/item", prefix)).toBe("{unknown}/item");
    expect(expandRoutePath("{toString}/item", {})).toBe("{toString}/item");
    expect(expandRoutePath("{__proto__}/item", {})).toBe("{__proto__}/item");
  });

  test("从解码后的主应用参数读取并展开子应用路由", () => {
    const state = readRouteState("https://host.test/?app=%7Bdetail%7D%2Fitem#/all");
    expect(getAppRoute(state, "app", prefix)).toBe("/products/special/item");
    expect(getAppRoute(state, "missing", prefix)).toBe("");
  });
});

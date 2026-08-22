import {
  List,
  NavigationLink,
  Text,
  useObservable,
  ProgressView,
  useEffect,
  Section,
  Navigation,
  Button,
  HStack,
  Spacer,
  VStack,
  Menu,
  Image,
  Script,
} from "scripting";
import { View as AddView } from "./add";
import { View as EditorView } from "./edit";
import { View as SettingView } from "./setting";
import { View as UpdateView } from "./update";
import { gist } from "../class/gist";

export function View({ navigationTitle }: { navigationTitle?: string }) {
  const list = useObservable<any[]>();
  const user = useObservable<any>();
  const userLoading = useObservable<boolean>(true);

  async function init() {
    if (!gist.token) {
      await Navigation.present(<SettingView />);
      if (!gist.token) {
        list.setValue([]);
        return;
      }
    }
    try {
      const r = await gist.get();
      list.setValue(r);
    } catch (e) {
      await Navigation.present(<SettingView />);
      if (!gist.token) {
        list.setValue([]);
        return;
      }
      await init();
    }
  }

  async function fetchUser() {
    if (!gist.token) {
      userLoading.setValue(false);
      return;
    }
    try {
      const r = await gist.getUser();
      user.setValue(r);
    } catch (e) {
      // ignore
    } finally {
      userLoading.setValue(false);
    }
  }

  useEffect(() => {
    Storage.set("gist_expanded_ids", "[]");
    init();
    fetchUser();

    // Home Tab 场景（Script.env === "home_screen"）下组件常驻，
    // 切回本 Tab 时列表不会自动重建，这里监听事件手动刷新。
    // 在 index.tsx 普通运行场景中注册无害：回调永远不会被触发。
    const off = Script.onHomeTabEvent((event) => {
      switch (event) {
        case "selected":
          // 从别的 Tab 切回来：整表刷新（带加载态）
          list.setValue(undefined);
          init();
          fetchUser();
          break;
        case "reselected":
          // 已经在 Home 上又点了一次 Home：静默刷新，避免闪加载态
          init();
          fetchUser();
          break;
      }
    });
    return () => off();
  }, []);

  if (list.value === undefined) return <ProgressView />;
  return (
    <List
      refreshable={async () => {
        await Promise.all([init(), fetchUser(), new Promise((r: any) => setTimeout(r, 500))]);
      }}
      toolbar={{
        topBarLeading: [
          <Button
            title={"添加Gist"}
            systemImage={"plus"}
            action={async () => {
              try {
                const r = await Navigation.present(<AddView />);
                if (!r) return;
                list.setValue(undefined);
                await init();
              } catch (e) {
                await Dialog.alert({
                  title: "错误",
                  message: String(e),
                });
              }
            }}
          />,
        ],
        topBarTrailing: [
          <Button
            title="刷新"
            systemImage="arrow.clockwise"
            action={async () => {
              list.setValue(undefined);
              await init();
              await fetchUser();
            }}
          />,
          <Button
            title="设置"
            systemImage="gear"
            action={() => {
              Navigation.present(<SettingView />);
            }}
          />,
        ],
        principal: [
          userLoading.value ? (
            <HStack spacing={6}>
              <ProgressView />
            </HStack>
          ) : user.value ? (
            <HStack spacing={8}>
              {user.value.avatar_url ? (
                <Image
                  imageUrl={user.value.avatar_url}
                  resizable
                  scaleToFill
                  frame={{ width: 28, height: 28 }}
                  clipShape={{ type: "rect", cornerRadius: 14 }}
                />
              ) : (
                <Image
                  systemName="person.circle.fill"
                  foregroundStyle="systemBlue"
                  font="title2"
                />
              )}
              <Text font="headline">{user.value.login}</Text>
            </HStack>
          ) : (
            <Text font="headline" foregroundStyle="secondaryLabel">
              {navigationTitle || "Gist"}
            </Text>
          ),
        ],
      }}>
      {list.value.map((info) => (
        <SecView key={info.id} info={info} list={list} />
      ))}
    </List>
  );
}

function SecView({ info, list }: { info: any; list: Observable<any[] | undefined> }) {
  const storageKey = "gist_expanded_ids";
  const initExpanded = (() => {
    const ids: string[] = JSON.parse(Storage.get(storageKey) || "[]");
    return ids.includes(info.id);
  })();
  const isExpand = useObservable<boolean>(initExpanded);

  useEffect(() => {
    const ids: string[] = JSON.parse(Storage.get(storageKey) || "[]");
    const idx = ids.indexOf(info.id);
    if (isExpand.value && idx === -1) {
      ids.push(info.id);
      Storage.set(storageKey, JSON.stringify(ids));
    } else if (!isExpand.value && idx !== -1) {
      ids.splice(idx, 1);
      Storage.set(storageKey, JSON.stringify(ids));
    }
  }, [isExpand.value]);

  async function init() {
    if (!gist.token) {
      await Navigation.present(<SettingView />);
      if (!gist.token) return;
    }
    try {
      const r = await gist.get();
      list.setValue(r);
    } catch (e) {
      await Navigation.present(<SettingView />);
      if (!gist.token) return;
      await init();
    }
  }

  return (
    <Section
      isExpanded={isExpand}
      header={
        <HStack>
          <VStack alignment={"leading"}>
            {info.public ? (
              <Text lineLimit={1}>
                {Object.keys(info.files).length > 0
                  ? `${info.owner.login}/${info.files[Object.keys(info.files)[0]].filename}`
                  : `${info.owner.login}/`}
              </Text>
            ) : (
              <HStack>
                <Text lineLimit={1}>
                  {Object.keys(info.files).length > 0
                    ? `${info.owner.login}/${info.files[Object.keys(info.files)[0]].filename}`
                    : `${info.owner.login}/`}
                </Text>
                <Image
                  systemName={"lock.fill"}
                  imageScale={"small"}
                  foregroundStyle={"tertiaryLabel"}
                />
              </HStack>
            )}

            <Text lineLimit={1} font={"footnote"} foregroundStyle={"tertiaryLabel"}>
              {info.description || "无描述"}
            </Text>
          </VStack>
          <Spacer />
          <Menu title={""} systemImage={"ellipsis"} buttonStyle={"plain"}>
            <Section title={"操作"}>
              <Button
                title={"添加文件"}
                systemImage={"plus"}
                action={async () => {
                  try {
                    const r = await Navigation.present(<UpdateView url={info.url} />);
                    if (!r) return;
                    list.setValue(undefined);
                    await init();
                  } catch (e) {
                    await Dialog.alert({
                      title: "错误",
                      message: String(e),
                    });
                  }
                }}
              />
              <Button
                title={"编辑描述"}
                systemImage={"text.alignleft"}
                action={async () => {
                  try {
                    const desc = await Dialog.prompt({
                      title: "请输入描述",
                      defaultValue: info.description || "",
                    });

                    if (desc === null || desc === undefined) return;

                    list.setValue(undefined);
                    await gist.updateDescription(info.url, desc);
                    await init();
                  } catch (e) {
                    await Dialog.alert({
                      title: "错误",
                      message: String(e),
                    });
                  }
                }}
              />
            </Section>
            <Section>
              <Button
                title={"删除"}
                systemImage={"trash"}
                role={"destructive"}
                action={async () => {
                  try {
                    list.setValue(undefined);
                    await gist.delete(info.url);
                  } catch (e) {
                    await init();
                  }
                }}
              />
            </Section>
          </Menu>
        </HStack>
      }
    >
      {Object.values(info.files).map((i: any) => (
        <Item
          key={i.filename}
          filename={i.filename}
          list={list}
          info={info}
          contextMenu={{
            menuItems: (
              <>
                <Section>
                  <Button
                    title={"拷贝链接"}
                    systemImage={"doc.on.pencil"}
                    action={async () => {
                      try {
                        await Pasteboard.setString(i.raw_url);
                      } catch (e) {
                        await Dialog.alert({
                          title: "错误",
                          message: String(e),
                        });
                      }
                    }}
                  />
                  <Button
                    title={"重命名"}
                    systemImage={"square.and.pencil"}
                    action={async () => {
                      try {
                        const name = await Dialog.prompt({
                          title: "请输入文件名",
                          defaultValue: i.filename,
                        });
                        if (name === null || name === undefined) return;
                        if (name === "") throw "文件名不能为空";

                        list.setValue(undefined);
                        const content = await gist.getContent(i.raw_url);

                        await gist.deleteContent(info.url, i.filename);
                        await gist.updateContent(info.url, name, content);

                        await init();
                      } catch (e) {
                        await Dialog.alert({
                          title: "错误",
                          message: String(e),
                        });
                      }
                    }}
                  />
                </Section>
                <Section>
                  <Button
                    title={"删除"}
                    systemImage={"trash"}
                    role={"destructive"}
                    action={async () => {
                      try {
                        list.setValue(undefined);
                        await gist.deleteContent(info.url, i.filename);
                        await init();
                      } catch (e) {
                        await Dialog.alert({
                          title: "错误",
                          message: String(e),
                        });
                      }
                    }}
                  />
                </Section>
              </>
            ),
          }}
        />
      ))}
    </Section>
  );
}

function Item({
  filename,
  info,
  list,
}: {
  filename: string;
  info: any;
  list: Observable<any[] | undefined>;
}) {
  return (
    <NavigationLink
      title={filename}
      destination={
        <EditorView
          list={list}
          info={info}
          filename={filename}
          navigationTitle={filename}
          navigationBarTitleDisplayMode={"inline"}
        />
      }
    />
  );
}

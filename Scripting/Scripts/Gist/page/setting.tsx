import {
  List,
  Navigation,
  NavigationStack,
  Button,
  TextField,
  Section,
  useObservable,
  useEffect,
  Image,
  Text,
  HStack,
  VStack,
  Spacer,
  ProgressView,
} from "scripting";
import { gist } from "../class/gist";

export function View() {
  const dismiss = Navigation.useDismiss();
  return (
    <NavigationStack>
      <StackView
        navigationTitle={"设置"}
        toolbar={{
          cancellationAction: [<Button title={"取消"} systemImage={"xmark"} action={dismiss} />],
          confirmationAction: [
            <Button
              title="保存"
              systemImage={"checkmark"}
              action={() => {
                gist.save();
                dismiss();
              }}
            />,
          ],
        }}
      />
    </NavigationStack>
  );
}

function StackView() {
  return (
    <List>
      <UserInfoView />
      <GistView />
      <AboutView />
    </List>
  );
}

function UserInfoView() {
  const user = useObservable<any>();
  const loading = useObservable<boolean>(true);
  const error = useObservable<string>("");

  useEffect(() => {
    (async () => {
      if (!gist.token) {
        loading.setValue(false);
        return;
      }
      try {
        const r = await gist.getUser();
        user.setValue(r);
      } catch (e: any) {
        error.setValue(String(e));
      } finally {
        loading.setValue(false);
      }
    })();
  }, []);

  if (loading.value) {
    return (
      <Section>
        <HStack>
          <ProgressView />
          <Text foregroundStyle={"secondaryLabel"}>正在获取用户信息...</Text>
        </HStack>
      </Section>
    );
  }

  if (error.value || !user.value) {
    return (
      <Section title="用户">
        <Text foregroundStyle={"secondaryLabel"} font={"footnote"}>
          {error.value ? `获取失败：${error.value}` : "未登录，请设置 Token"}
        </Text>
      </Section>
    );
  }

  return (
    <Section title="用户">
      <HStack spacing={12}>
        {user.value.avatar_url ? (
          <Image
            imageUrl={user.value.avatar_url}
            resizable
            scaleToFill
            frame={{ width: 28, height: 28 }}
            clipShape={{ type: "rect", cornerRadius: 14 }}
          />
        ) : (
          <Image systemName={"person.circle.fill"} foregroundStyle={"systemBlue"} font={"title2"} />
        )}
        <VStack alignment={"leading"}>
          <Text font={"headline"}>{user.value.login}</Text>
          {user.value.name && user.value.name !== user.value.login ? (
            <Text font={"footnote"} foregroundStyle={"secondaryLabel"}>
              {user.value.name}
            </Text>
          ) : null}
        </VStack>
        <Spacer />
      </HStack>
    </Section>
  );
}

function AboutView() {
  return (
    <Section title="关于">
      <Text font={"footnote"} foregroundStyle={"secondaryLabel"}>
        此脚本改于001大佬
      </Text>
    </Section>
  );
}

function GistView() {
  function TokenView() {
    const value = useObservable(gist.token);
    useEffect(() => {
      gist.token = value.value;
    }, [value.value]);
    return <TextField title="Token" value={value} />;
  }
  return (
    <Section title="Gist">
      <TokenView />
    </Section>
  );
}

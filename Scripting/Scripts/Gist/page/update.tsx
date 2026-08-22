import {
  Editor,
  ProgressView,
  Button,
  Image,
  useMemo,
  useEffect,
  useObservable,
  List,
  Section,
  Navigation,
  NavigationStack,
} from "scripting";
import { gist } from "../class/gist";

export function View({ url }: { url: string }) {
  const dismiss = Navigation.useDismiss();
  return (
    <NavigationStack>
      <List
        navigationTitle={"添加文件"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarLeading: [<Button title={"取消"} systemImage={"xmark"} action={dismiss} />],
        }}>
        <Section title={"内容"}>
          <MyEditor listRowInsets={0} frame={{ height: 400 }} url={url} />
        </Section>
      </List>
    </NavigationStack>
  );
}

function MyEditor({ url }: { url: string }) {
  const controller = useMemo(() => {
    return new EditorController({ content: "", ext: "txt" });
  }, []);

  useEffect(() => {
    return () => controller.dispose();
  }, [controller]);

  function SaveButton() {
    const dismiss = Navigation.useDismiss();

    const isload = useObservable<boolean>(false);
    return (
      <Button
        action={async () => {
          try {
            if (!controller.content) throw "内容不能为空";
            const name =
              (await Dialog.prompt({
                title: "请输入文件名",
              })) || "gistfile1.txt";

            isload.setValue(true);
            await gist.updateContent(url, name, controller.content);
            dismiss(true);
          } catch (e) {
            await Dialog.alert({
              title: "错误",
              message: String(e),
            });
          }
          isload.setValue(false);
        }}>
        {isload.value ? <ProgressView /> : <Image systemName={"checkmark"} />}
      </Button>
    );
  }

  return (
    <Editor
      controller={controller}
      scriptName="编辑器"
      toolbar={{
        confirmationAction: [<SaveButton />],
      }}
    />
  );
}

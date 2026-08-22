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
  Toggle,
} from "scripting";
import { gist } from "../class/gist";

let isPublic = false;

export function View() {
  const dismiss = Navigation.useDismiss();
  return (
    <NavigationStack>
      <List
        navigationTitle={"添加Gist"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarLeading: [<Button title={"取消"} systemImage={"xmark"} action={dismiss} />],
        }}>
        <Section title={"选项"}>
          <IsPublicView />
        </Section>

        <Section title={"内容"}>
          <MyEditor listRowInsets={0} frame={{ height: 400 }} />
        </Section>
      </List>
    </NavigationStack>
  );
}

function IsPublicView() {
  const v = useObservable(isPublic);

  useEffect(() => {
    isPublic = v.value;
  }, [v.value]);

  return (
    <Toggle
      title={"是否公开"}
      value={v}
      systemImage={"link.circle.fill"}
      symbolRenderingMode={"hierarchical"}
    />
  );
}

function MyEditor() {
  const controller = useMemo(() => {
    return new EditorController({ content: "", ext: "txt" });
  }, []);

  useEffect(() => {
    return () => controller.dispose();
  }, [controller]);

  return (
    <Editor
      controller={controller}
      scriptName="编辑器"
      toolbar={{
        confirmationAction: [<SaveButton controller={controller} />],
      }}
    />
  );
}

function SaveButton({ controller }: { controller: EditorController }) {
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
          await gist.create(name, controller.content, isPublic, "");
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

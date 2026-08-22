import { Image, Path, ProgressView, useEffect, useObservable } from "scripting";
import { Button, Editor, useMemo } from "scripting";
import { gist } from "../class/gist";

export function View({
  filename,
  info,
  list,
}: {
  filename: string;
  info: any;
  list: Observable<any[] | undefined>;
}) {
  const file = useObservable<string>();

  async function init() {
    try {
      const r = await gist.getContent(info.files[filename].raw_url);
      file.setValue(r);
    } catch (e) {
      await Dialog.alert({
        title: "错误",
        message: String(e),
      });
    }
  }

  useEffect(() => {
    init();
  }, []);

  if (file.value === undefined) return <ProgressView title={"加载中"} />;
  return <MyEditor info={info} filename={filename} file={file.value} list={list} />;
}

let isSave = false;

function MyEditor({
  info,
  filename,
  file,
  list,
}: {
  info: any;
  filename: string;
  file: string;
  list: Observable<any[] | undefined>;
}) {
  const controller = useMemo(() => {
    return new EditorController({ content: file ?? "", ext: Path.extname(filename) as any });
  }, []);

  useEffect(() => {
    isSave = false;
    return () => {
      async function reload() {
        try {
          if (!isSave) return;

          list.setValue(undefined);
          const r = await gist.get();
          // console.log(r);
          list.setValue(r);
        } catch (e) {
          await Dialog.alert({
            title: "错误",
            message: String(e),
          });
        }
      }

      reload();
      controller.dispose();
    };
  }, [controller]);

  return (
    <Editor
      controller={controller}
      scriptName={"编辑器"}
      showAccessoryView={true}
      toolbar={{
        confirmationAction: [
          <SaveButton info={info} filename={filename} controller={controller} />,
        ],
      }}
    />
  );
}

function SaveButton({
  info,
  filename,
  controller,
}: {
  info: any;
  filename: string;
  controller: EditorController;
}) {
  const isload = useObservable<boolean>(false);
  return (
    <Button
      action={async () => {
        isload.setValue(true);
        try {
          isSave = true;
          await gist.updateContent(info.url, filename, controller.content);
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

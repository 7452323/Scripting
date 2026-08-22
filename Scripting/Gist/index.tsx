import { Navigation, Script } from "scripting";
import { View } from "./page";

(async () => {
  await Navigation.present({
    element: <View />,
    modalPresentationStyle: "overFullScreen",
  });
})()
  .catch(
    async (e) =>
      await Dialog.alert({
        title: "错误",
        message: String(e),
      }),
  )
  .finally(Script.exit);

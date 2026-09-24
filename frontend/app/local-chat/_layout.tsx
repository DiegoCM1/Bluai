import { Redirect, Stack } from "expo-router";

import { NicknameModal } from "./_components/NicknameModal";
import {
  LocalChatProvider,
  useLocalChatContext,
} from "./_context/LocalChatProvider";
import { LOCAL_CHAT_ENABLED } from "../../utils/platformFeatures";

/** Forces a nickname on first use — it's the stable identity, not cosmetic. */
function NicknameGate() {
  const { needsNickname, nickname, setNickname } = useLocalChatContext();
  return (
    <NicknameModal
      visible={needsNickname}
      initial={nickname}
      dismissable={false}
      onSave={setNickname}
    />
  );
}

export default function LocalChatLayout() {
  // Above the provider on purpose: returning here means LocalChatProvider never
  // mounts, so no transport is constructed and no nickname modal is raised on a
  // platform where the radio doesn't exist. One guard covers /local-chat,
  // /local-chat/chat, /local-chat/mesh and all three blueye:// deep links —
  // expo-router serves a file-based route regardless of what the menu draws.
  if (!LOCAL_CHAT_ENABLED) {
    return <Redirect href="/(tabs)/MoreScreen" />;
  }

  return (
    <LocalChatProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="chat" />
        <Stack.Screen name="mesh" />
      </Stack>
      <NicknameGate />
    </LocalChatProvider>
  );
}

import { LayoutGrid } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
} from "@/components/ui/icon-button-chrome";
import { isWeb } from "@/constants/platform";
import { toggleBigGoalsBoard } from "@/utils/big-goals-board";

const ThemedLayoutGrid = withUnistyles(LayoutGrid);

/** Opens the big-goals board the way the extension's own button does: the key event it listens for. */
export function BigGoalsBoardButton() {
  const { t } = useTranslation();
  const label = t("workspace.header.board");

  const handlePress = useCallback(() => {
    toggleBigGoalsBoard();
  }, []);

  if (!isWeb) {
    return null;
  }

  return (
    <HeaderToggleButton
      testID="workspace-big-goals-board"
      onPress={handlePress}
      tooltipLabel={label}
      tooltipKeys={[]}
      tooltipSide="bottom"
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <ThemedLayoutGrid
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}

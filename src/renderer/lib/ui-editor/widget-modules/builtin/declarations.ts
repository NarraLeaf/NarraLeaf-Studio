import type { UIWidgetDeclaration } from "../types";
import { RootWidgetDeclaration } from "./root.declaration";
import { TextWidgetDeclaration } from "./text.declaration";
import { ImageWidgetDeclaration } from "./image.declaration";
import { VideoWidgetDeclaration } from "./video.declaration";
import { PuppetWidgetDeclaration } from "./puppet.declaration";
import { ContainerWidgetDeclaration } from "./container.declaration";
import { ButtonWidgetDeclaration } from "./button.declaration";
import { ListWidgetDeclaration } from "./list.declaration";
import { FrameWidgetDeclaration } from "./frame.declaration";
import { SliderWidgetDeclaration } from "./slider.declaration";
import { SwitchWidgetDeclaration } from "./switch.declaration";
import { TextInputWidgetDeclaration } from "./textInput.declaration";
import { DialogSentenceWidgetDeclaration } from "./dialog.declaration";
import { NotificationListWidgetDeclaration } from "./notificationList.declaration";
import { ChoiceListWidgetDeclaration } from "./choiceList.declaration";
import { NvlListWidgetDeclaration } from "./nvlList.declaration";
import { NvlTextsWidgetDeclaration } from "./nvl.declaration";
import { InputHintsWidgetDeclaration } from "./inputHints.declaration";

export const BuiltinWidgetDeclarations: readonly UIWidgetDeclaration[] = [
    RootWidgetDeclaration,
    ContainerWidgetDeclaration,
    TextWidgetDeclaration,
    ImageWidgetDeclaration,
    VideoWidgetDeclaration,
    PuppetWidgetDeclaration,
    ButtonWidgetDeclaration,
    TextInputWidgetDeclaration,
    SliderWidgetDeclaration,
    SwitchWidgetDeclaration,
    ListWidgetDeclaration,
    FrameWidgetDeclaration,
    DialogSentenceWidgetDeclaration,
    NotificationListWidgetDeclaration,
    ChoiceListWidgetDeclaration,
    NvlListWidgetDeclaration,
    NvlTextsWidgetDeclaration,
    InputHintsWidgetDeclaration,
];

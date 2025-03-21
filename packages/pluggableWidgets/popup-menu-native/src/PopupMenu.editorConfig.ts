import {
    StructurePreviewProps,
    DropZoneProps,
    ContainerProps,
    RowLayoutProps,
    topBar
} from "@mendix/piw-utils-internal";
import { hidePropertyIn, Properties } from "@mendix/pluggable-widgets-tools";

import { BasicItemsPreviewType, PopupMenuPreviewProps } from "../typings/PopupMenuProps";

export function getPreview(values: PopupMenuPreviewProps, isDarkMode: boolean): StructurePreviewProps {
    const content: StructurePreviewProps[] = [
        {
            type: "Container",
            borders: true,
            children: [
                {
                    type: "DropZone",
                    placeholder: "Clickable area to show menu",
                    property: values.menuTriggerer
                }
            ]
        },
        { type: "Container", padding: 4 },
        ...(values.popupRenderMode === "basic"
            ? values.basicItems.map<ContainerProps>((value, index) => ({
                  type: "Container",
                  children: [
                      ...(value.itemType === "item"
                          ? ([
                                {
                                    type: "RowLayout",
                                    columnSize: "fixed",
                                    children: [
                                        {
                                            type: "RowLayout",
                                            padding: 18,
                                            borders: true,
                                            columnSize: "grow",
                                            children: [
                                                {
                                                    type: "Container",
                                                    grow: 1
                                                },
                                                {
                                                    type: "Text",
                                                    content: value.caption || `[Item ${index + 1}]`
                                                },
                                                {
                                                    type: "Container",
                                                    grow: 1
                                                }
                                            ]
                                        },
                                        {
                                            type: "Container",
                                            grow: 2
                                        }
                                    ]
                                }
                            ] as RowLayoutProps[])
                          : ([
                                {
                                    type: "Container",
                                    padding: 4
                                }
                            ] as ContainerProps[]))
                  ]
              }))
            : values.customItems.map<DropZoneProps>((value, index) => ({
                  type: "DropZone",
                  placeholder: `Items/${index + 1}/Content`,
                  property: value.content
              })))
    ];
    return topBar("Pop-up menu", content, isDarkMode);
}

export function getProperties(values: PopupMenuPreviewProps, defaultProperties: Properties): Properties {
    if (values.popupRenderMode === "basic") {
        hidePropertyIn(defaultProperties, values, "customItems");

        values.basicItems.forEach((item: BasicItemsPreviewType, index: number) => {
            if (item.itemType === "divider") {
                hidePropertyIn(defaultProperties, values, "basicItems", index, "caption");
                hidePropertyIn(defaultProperties, values, "basicItems", index, "action");
                hidePropertyIn(defaultProperties, values, "basicItems", index, "styleClass");
            }
        });
    } else {
        hidePropertyIn(defaultProperties, values, "basicItems");
    }
    return defaultProperties;
}

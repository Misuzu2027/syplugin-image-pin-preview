import { EnvConfig } from "@/config/EnvConfig";
import { ItemProperty, IOption, TabProperty } from "./setting-model";

export function getSettingTabArray(): TabProperty[] {

    let tabProperties: TabProperty[] = [

    ];

    tabProperties.push(
        new TabProperty({
            key: "image-pin-preview-default", name: "默认", iconKey: "iconFilter", props: [
                new ItemProperty({ key: "isOpen", type: "switch", name: "开启", description: "", tips: "" }), 
            ]

        }),

    );

    return tabProperties;
}


function getDocSortModeElement(): IOption[] {
    let docSortModeElements = SETTING_DOCUMENT_SORT_MODE_ELEMENT();
    let options: IOption[] = [];
    for (const element of docSortModeElements) {
        options.push(element);
    }

    return options;
}

function getContentBlockSortModeElement(): IOption[] {
    let contentBlockSortModeElements = SETTING_CONTENT_BLOCK_SORT_MODE_ELEMENT();
    let options: IOption[] = [];
    for (const element of contentBlockSortModeElements) {
        options.push(element);
    }

    return options;
}


function getQueryRelationTypeElement(): IOption[] {

    let options: IOption[] = [];
    options.push({
        name: "引用", value: "RefBlock", iconId: "#iconRefStyle"
    })
    options.push({
        name: "超链接", value: "Hyperlink", iconId: "#iconLink"
    })
    options.push({
        name: "数据库", value: "AttributeView", iconId: "#iconDatabase"
    })

    return options;
}




function getBlockTypeElement(): IOption[] {
    let blockTypeElements = SETTING_QUERY_BLOCK_TYPE_ELEMENT();
    let options: IOption[] = [];
    for (const element of blockTypeElements) {
        options.push(element);
    }

    return options;
}


export function SETTING_DOCUMENT_SORT_MODE_ELEMENT(): { name: string, value: DocumentSortMode }[] {
    return [
        // {
        //     name: EnvConfig.ins.i18n.sortByRankASC,
        //     value: "RankASC",

        // },
        // {
        //     name: EnvConfig.ins.i18n.sortByRankDESC,
        //     value: "RankDESC",
        // },
        {
            name: window.siyuan.languages.modifiedASC,
            value: "UpdatedASC",
        },
        {
            name: window.siyuan.languages.modifiedDESC,
            value: "UpdatedDESC",
        },
        {
            name: window.siyuan.languages.createdASC,
            value: "CreatedASC",
        },
        {
            name: window.siyuan.languages.createdDESC,
            value: "CreatedDESC",
        },
        {
            name: window.siyuan.languages.fileNameASC,
            value: "NameASC",
        },
        {
            name: window.siyuan.languages.fileNameDESC,
            value: "NameDESC",
        },
        {
            name: window.siyuan.languages.fileNameNatASC,
            value: "AlphanumASC",
        },
        {
            name: window.siyuan.languages.fileNameNatDESC,
            value: "AlphanumDESC",
        },
        {
            name: window.siyuan.languages.refCountASC,
            value: "RefCountASC",
        },
        {
            name: window.siyuan.languages.refCountDESC,
            value: "RefCountDESC",
        },

    ];
}


export function SETTING_CONTENT_BLOCK_SORT_MODE_ELEMENT(): { name: string, value: ContentBlockSortMode }[] {
    return [
        ...SETTING_DOCUMENT_SORT_MODE_ELEMENT(),
        {
            name: EnvConfig.ins.i18n.type,
            value: "Type",
        },
        {
            name: EnvConfig.ins.i18n.sortByContent,
            value: "Content",
        },
        {
            name: EnvConfig.ins.i18n.sortByTypeAndContent,
            value: "TypeAndContent",
        },
    ];
}

export function SETTING_QUERY_BLOCK_TYPE_ELEMENT(): { name: string, value: BlockType, iconId: string }[] {
    return [
        {
            name: window.siyuan.languages.math,
            value: "m",
            iconId: `#iconMath`,
        },
        {
            name: window.siyuan.languages.table,
            value: "t",
            iconId: `#iconTable`,
        },
        {
            name: window.siyuan.languages.paragraph,
            value: "p",
            iconId: `#iconParagraph`,
        },
        {
            name: window.siyuan.languages.headings,
            value: "h",
            iconId: `#iconHeadings`,
        },
        {
            name: window.siyuan.languages.code,
            value: "c",
            iconId: `#iconCode`,
        },
        {
            name: "HTML",
            value: "html",
            iconId: `#iconHTML5`,
        },
        {
            name: window.siyuan.languages.database,
            value: "av",
            iconId: `#iconDatabase`,
        },
        {
            name: window.siyuan.languages.embedBlock,
            value: "query_embed",
            iconId: `#iconSQL`,
        },
        {
            name: window.siyuan.languages.video,
            value: "video",
            iconId: `#iconVideo`,
        },
        {
            name: window.siyuan.languages.audio,
            value: "audio",
            iconId: `#iconRecord`,
        },
        {
            name: "IFrame",
            value: "iframe",
            iconId: `#iconLanguage`,
        },
        {
            name: window.siyuan.languages.widget,
            value: "widget",
            iconId: `#iconBoth`,
        },
        {
            name: window.siyuan.languages.quote,
            value: "b",
            iconId: `#iconQuote`,
        },
        {
            name: window.siyuan.languages.superBlock,
            value: "s",
            iconId: `#iconSuper`,
        },
        {
            name: window.siyuan.languages.list1,
            value: "l",
            iconId: `#iconList`,
        },
        {
            name: window.siyuan.languages.listItem,
            value: "i",
            iconId: `#iconListItem`,
        },
        {
            name: window.siyuan.languages.doc,
            value: "d",
            iconId: `#iconFile`,
        },
    ];
}
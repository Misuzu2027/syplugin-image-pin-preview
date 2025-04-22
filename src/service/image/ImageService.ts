import { EnvConfig } from "@/config/EnvConfig";
import Instance from "@/utils/Instance";
import { SettingService } from "../setting/SettingService";
import ImagePreviewerSvelte from "@/components/image/ImagePreviewer.svelte"
import { isStrBlank, isStrNotBlank } from "@/utils/string-util";
import { getBlockByID, getDocImageAssets, sql } from "@/utils/api";
import { hasClosestById, hasClosestBySelector, stringToElement, wrapElementsInParent } from "@/utils/html-util";
import { isArrayEmpty } from "@/utils/array-util";
import { SvelteComponent, SvelteComponentTyped } from "svelte";

export class ImageService {

    public static get ins(): ImageService {
        return Instance.get(ImageService);
    }

    init() {
        let plugin = EnvConfig.ins.plugin;
        initBusEvent();

    }
}


function initBusEvent() {


    EnvConfig.ins.plugin.eventBus.off("loaded-protyle-static", handleLoadedProtyle);
    EnvConfig.ins.plugin.eventBus.off("loaded-protyle-dynamic", handleLoadedProtyle);
    EnvConfig.ins.plugin.eventBus.off("ws-main", handleWsMain);


    EnvConfig.ins.plugin.eventBus.on("loaded-protyle-static", handleLoadedProtyle);
    EnvConfig.ins.plugin.eventBus.on("loaded-protyle-dynamic", handleLoadedProtyle);
    EnvConfig.ins.plugin.eventBus.on("ws-main", handleWsMain);

    // EnvConfig.ins.plugin.eventBus.on("misuzu2027-", handleLoadedProtyle);

}


function handleLoadedProtyle(e) {
    console.log("handleLoadedProtyle ", e)
    // let protyleElement = e.detail.protyle.element;
    // addObserveCodeBlockLanguageElement(protyleElement);
    let wysiwygElement = e.detail.protyle.wysiwyg.element;
    initProtyleElement(wysiwygElement,);


}


function handleWsMain(e) {
    if (e.detail.cmd != "transactions"
        || !e.detail.data
    ) {
        return;
    }
    console.log("handleWsMain ", e)

    let existUpdateImg = false;

    for (const dataObj of e.detail.data) {
        if (!dataObj || !dataObj.doOperations) {
            continue;
        }
        for (const doOperation of dataObj.doOperations) {
            if (doOperation && (doOperation.action == "update" || doOperation.action == "insert")) {
                let operationElement = stringToElement(doOperation.data);
                if (operationElement && operationElement.querySelectorAll(`span[data-type*="img"].img img`)) {
                    console.log("doOperation ", doOperation)
                    existUpdateImg = true;
                    break;
                }
            }
        }
    }
    if (!existUpdateImg) {
        return;
    }
    setTimeout(() => {
        initImgElementList(document.querySelectorAll(`span[data-type*="img"].img img`));
    }, 100);

}




function initProtyleElement(protyleContentElement: HTMLElement) {
    let imgElementArray = protyleContentElement.querySelectorAll(`span[data-type*="img"].img img`);
    initImgElementList(imgElementArray);

    // setTimeout(() => {
    //     let avImgElementArray = protyleContentElement.querySelectorAll(`div.av__cell img.av__cellassetimg`);
    //     console.log("avImgElementArray ", avImgElementArray)
    //     initAvImgElementList(avImgElementArray);
    // }, 1000);

}
const IMG_ATTR_NAME = "misuzu2027-img-pin-dbl";
let maxZIndex = 99999;
let previewCount = 0;

function initImgElementList(imgElements: NodeListOf<Element>) {
    if (!imgElements) return;

    imgElements.forEach(imgElement => {
        if (isStrNotBlank(imgElement.getAttribute(IMG_ATTR_NAME))) return;

        imgElement.setAttribute(IMG_ATTR_NAME, "1");
        imgElement.addEventListener("dblclick", handleImageDoubleClick);
    });
}


async function handleImageDoubleClick(event: MouseEvent) {
    if (!SettingService.ins.SettingConfig.isOpen) {
        return;
    }
    event.stopPropagation();

    const { target } = event;
    if (!(target instanceof HTMLElement)) return;

    let imgAssets: string[] = [];
    let imgIndex = 0;

    if (event.ctrlKey) {
        let imgRes = getImagesFromWysiwyg(target, `span[data-type*="img"].img img`);
        imgAssets = imgRes.imgAssets;
        imgIndex = imgRes.imgIndex;
    } else {
        let imgRes = await getImagesFromDoc(target);
        imgAssets = imgRes.imgAssets;
        imgIndex = imgRes.imgIndex;
    }

    if (imgAssets.length === 0) return;

    console.log("imgAssets ", imgAssets, " ,imgIndex ", imgIndex);
    previewImages(imgAssets, imgIndex);
}

function initAvImgElementList(imgElements: NodeListOf<Element>) {
    if (!imgElements) return;

    imgElements.forEach(imgElement => {
        if (isStrNotBlank(imgElement.getAttribute(IMG_ATTR_NAME))) return;

        imgElement.setAttribute(IMG_ATTR_NAME, "1");
        imgElement.addEventListener("click", handleImageClick);
    });
}


async function handleImageClick(event: MouseEvent) {

    const { target } = event;
    if (!(target instanceof HTMLElement)) return;

    let imgAssets: string[] = [];
    let imgIndex = 0;

    if (event.ctrlKey) {
        event.stopPropagation();
        let imgRes = getImagesFromWysiwyg(target, `div.av__cell img.av__cellassetimg`);
        imgAssets = imgRes.imgAssets;
        imgIndex = imgRes.imgIndex;
    }
    if (imgAssets.length === 0) return;

    console.log("imgAssets ", imgAssets, " ,imgIndex ", imgIndex);
    previewImages(imgAssets, imgIndex);
}



function getImagesFromWysiwyg(target: HTMLElement, selectorText: string): { imgAssets: string[], imgIndex: number } {
    const wysiwygElement = hasClosestBySelector(target, ".protyle-wysiwyg", true);
    let result = { imgAssets: [], imgIndex: -1 }
    if (!wysiwygElement) return result;;

    const imgElements = wysiwygElement.querySelectorAll(selectorText);
    let index = 0;
    for (const imgElement of imgElements) {
        result.imgAssets.push(imgElement.getAttribute("src"));
        if (target == imgElement) {
            result.imgIndex = index;
        }
        index++;
    }
    return result;
}

async function getImagesFromDoc(target: HTMLElement): Promise<{ imgAssets: string[], imgIndex: number }> {
    const blockElement = hasClosestBySelector(target, "[data-node-id][data-type]");
    let result = { imgAssets: [], imgIndex: -1 }
    if (!blockElement) return result;
    const imgSrc = target.getAttribute("src");

    const blockId = blockElement.getAttribute("data-node-id");
    result.imgAssets = await getDocImageAssets(blockId)
    result.imgIndex = result.imgAssets.indexOf(imgSrc)
    return result;
}


export function previewImages(images: string[], startIndex = 0) {
    previewCount++;
    maxZIndex++;

    const container = createPreviewContainer();
    container.addEventListener("mousedown", handleContainerMouseDown);

    const imagePreviewerSvelte = new ImagePreviewerSvelte({
        target: container,
        props: {
            images,
            startIndex,
            onClose: () => closeImagePreview(imagePreviewerSvelte, container)
        }
    });
}

function createPreviewContainer(): HTMLElement {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.zIndex = String(maxZIndex);
    container.style.pointerEvents = "none";
    document.body.appendChild(container);
    return container;
}

function handleContainerMouseDown(event: MouseEvent) {
    const divElement = event.currentTarget as HTMLElement;
    let curZIndex = Number(window.getComputedStyle(divElement).zIndex);
    if (curZIndex === maxZIndex) return;

    maxZIndex++;
    divElement.style.zIndex = String(maxZIndex);
}

function closeImagePreview(imagePreviewerSvelte: SvelteComponent, container: HTMLElement) {
    console.log("closeImagePreview")
    imagePreviewerSvelte?.$destroy();
    container.remove();
    previewCount--;

    if (previewCount <= 0) {
        previewCount = 0;
        maxZIndex = 99999;
    }
}

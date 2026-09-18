export const IPP_ICON_SVG = `
<symbol id="ippIconZoomIn" viewBox="0 0 24 24">
    <path d="M11 5.5a5.5 5.5 0 1 0 3.47 9.76l3.64 3.63 1.41-1.41-3.63-3.64A5.5 5.5 0 0 0 11 5.5zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"></path>
    <path d="M10 8.5h2v5h-2z"></path>
    <path d="M8.5 10h5v2h-5z"></path>
</symbol>
<symbol id="ippIconZoomOut" viewBox="0 0 24 24">
    <path d="M11 5.5a5.5 5.5 0 1 0 3.47 9.76l3.64 3.63 1.41-1.41-3.63-3.64A5.5 5.5 0 0 0 11 5.5zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z"></path>
    <path d="M8.5 10h5v2h-5z"></path>
</symbol>
<symbol id="ippIconActual" viewBox="0 0 24 24">
    <path d="M5 7h4V5H3v6h2V7zm10-2v2h4v4h2V5h-6zM5 17v-4H3v6h6v-2H5zM19 17v-4h2v6h-6v-2h4z"></path>
    <path d="M8.2 9h1.7l1.1 3.2L12.2 9h1.6l-2 6h-1.6L8.2 9z"></path>
</symbol>
<symbol id="ippIconFit" viewBox="0 0 24 24">
    <path d="M4 9V5h4v2H6v2H4zm14-4h4v4h-2V7h-2V5zM4 15h2v2h2v2H4v-4zM20 15h-2v2h-2v2h4v-4z"></path>
    <path d="M8 8h8v8H8z"></path>
</symbol>
<symbol id="ippIconRotateLeft" viewBox="0 0 24 24">
    <path d="M12.5 7V5.2L8.8 8.5 12.5 11.8V10c2.5 0 4.5 2 4.5 4.5S15 19 12.5 19 8 17 8 14.5H6c0 3.6 2.9 6.5 6.5 6.5s6.5-2.9 6.5-6.5S16.1 8 12.5 8z"></path>
</symbol>
<symbol id="ippIconRotateRight" viewBox="0 0 24 24">
    <path d="M11.5 7V5.2L15.2 8.5 11.5 11.8V10C9 10 7 12 7 14.5S9 19 11.5 19s4.5-2 4.5-4.5H18c0 3.6-2.9 6.5-6.5 6.5S5 18.1 5 14.5 7.9 8 11.5 8z"></path>
</symbol>
<symbol id="ippIconFlipH" viewBox="0 0 24 24">
    <path d="M11 4h2v16h-2z"></path>
    <path d="M8 7 3 12l5 5V7zm8 0v10l5-5-5-5z"></path>
</symbol>
<symbol id="ippIconFlipV" viewBox="0 0 24 24">
    <path d="M4 11h16v2H4z"></path>
    <path d="M7 8 12 3l5 5H7zm0 8h10l-5 5-5-5z"></path>
</symbol>
<symbol id="ippIconPrev" viewBox="0 0 24 24">
    <path d="M15.4 6.4 9.8 12l5.6 5.6-1.4 1.4L7 12l7-7z"></path>
</symbol>
<symbol id="ippIconNext" viewBox="0 0 24 24">
    <path d="M8.6 6.4 14.2 12l-5.6 5.6 1.4 1.4 7-7-7-7z"></path>
</symbol>
<symbol id="ippIconClose" viewBox="0 0 24 24">
    <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5z"></path>
</symbol>
<symbol id="ippIconCopyFile" viewBox="0 0 24 24">
    <path d="M7 3h7l5 5v13H7V3zm7 1.8V9h4.2L14 4.8zM9 12h6v1.6H9V12zm0 3.2h6V17H9v-1.8z"></path>
</symbol>
<symbol id="ippIconCopyPNG" viewBox="0 0 24 24">
    <path d="M5 5h14v14H5V5zm2 10.2 2.6-3.3 2.1 2.5 1.7-2.1L17 15.2H7zM8.6 8.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"></path>
</symbol>
<symbol id="ippIconDock" viewBox="0 0 24 24">
    <path d="M16 12.2V5h1V3H7v2h1v7.2L6 14.5V16.5h5V21h2v-4.5h5v-2l-2-2.3z"></path>
</symbol>
`;

export const CUSTOM_ICON_MAP = {
    ippIcons: {
        source: IPP_ICON_SVG,
    },
};

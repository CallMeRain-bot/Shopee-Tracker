export const decodeHTMLEntities = (text) => {
    if (!text) return '';
    return text.replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
};

export const getShopeeImageUrl = (imageId) => {
    if (!imageId) return null;
    return `https://cf.shopee.vn/file/${imageId}`;
};

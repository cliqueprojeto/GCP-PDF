import type {LanguagePreference,LanguageSettings} from './locale';
/** A page of an open document: page `src` (zero based) of the immutable PDF `base`, plus an extra
 * clockwise rotation. Page structure edits only rewrite these references, so they are instant. */
export interface PageRef {id:string;base:string;src:number;rotate:number}
export interface Point {x:number;y:number}
export interface Rect {x:number;y:number;width:number;height:number}
export type ShapeKind='rect'|'ellipse'|'line'|'arrow'|'dimension'|'polyline'|'polygon'|'cloud'|'check'|'cross';
export type MeasureKind='distance'|'perimeter'|'area';
/** 'sans' | 'serif' | 'mono' (standard PDF faces) or the family name of an installed font. */
export type FontFamily=string;
/** Objects drawn over a page. Coordinates are PDF points in the page's unrotated space, measured from
 * the top-left corner of its crop box, so they follow the page when it is rotated or moved. */
export type PageObject={id:string;page:string}&(
 |{kind:'text';x:number;y:number;width:number;height:number;text:string;size:number;color:string;font:FontFamily;bold:boolean;italic:boolean;align:'left'|'center'|'right';rotation:number}
 |{kind:'image';x:number;y:number;width:number;height:number;asset:string;rotation:number}
 |{kind:'shape';shape:ShapeKind;x:number;y:number;width:number;height:number;points?:Point[];stroke:string;fill:string|null;strokeWidth:number;opacity:number;measure?:MeasureKind}
 |{kind:'ink';points:Point[];stroke:string;strokeWidth:number;opacity:number}
 |{kind:'note';x:number;y:number;width:number;height:number;text:string;author:string;createdAt:string;color:string;replies?:NoteReply[]}
 |{kind:'markup';style:'highlight'|'underline'|'strike';rects:Rect[];color:string;opacity:number}
);
export interface PdfAnnotation {page:string;index:number;subtype:string;author:string;text:string;rect:Rect}
export type PdfOperation =
 | {type:'delete-annotation';page:string;index:number}
 | {type:'rotate';pages:number[];degrees:number}
 | {type:'delete';pages:number[]}
 | {type:'blank';index:number}
 | {type:'reorder';order:number[]}
 | {type:'add-object';object:PageObject;dataUrl?:string}
 | {type:'update-object';object:PageObject}
 | {type:'delete-objects';ids:string[]}
 | {type:'set-fields';values:Record<string,FieldValue>}
 | {type:'set-metadata';values:Partial<DocumentMetadata>}
 | {type:'add-objects';objects:PageObject[]};
export type FieldValue=string|boolean|string[];
export interface DocumentInfo {annotations:PdfAnnotation[];id:string;name:string;path?:string;revision:number;savedRevision:number;pageCount:number;pages:PageRef[];objects:PageObject[];fields:Record<string,FieldValue>;canUndo:boolean;canRedo:boolean}
/** Field properties, as in Acrobat's Properties dialog (appearance, options, format). */
export interface FieldProps {name?:string;tooltip?:string;required?:boolean;read_only?:boolean;multiline?:boolean;font_size?:number;align?:'left'|'center'|'right';check_style?:'check'|'circle'|'cross'|'diamond'|'square'|'star';appearance?:{border?:string;fill?:string;text_color?:string;width?:number;style?:'solid'|'dashed'|'beveled'|'inset'|'underline'};format?:'none'|'date'|'currency'|'number'|'cpf'|'cnpj'|'cep'|'phone';options?:string[];caption?:string;action?:{type:'none'}|{type:'url';url:string}|{type:'page';page:number}|{type:'reset'}|{type:'print'}|{type:'submit';url:string}}
/** Description fields of the PDF (Info dictionary), editable under Revisar > Propriedades. */
export interface DocumentMetadata {title:string;author:string;subject:string;keywords:string;creator:string;producer:string;created?:string;modified?:string}
export interface DocumentStats {size:number;pageCount:number;words:number;characters:number;charactersNoSpaces:number;lines:number;annotations:number;images:number;fonts:string[];pages:{page:number;words:number;width:number;height:number;content:number;images:number;fonts:number;imageCount:number;total:number}[]}
/** A reply in a comment thread (saved as a PDF /Text annotation "in reply to" its note, as Acrobat does). */
export interface NoteReply {id:string;author:string;text:string;createdAt:string}
/** Input mask of a form field, read from its Acrobat format script. */
export type FieldFormat={kind:'mask'|'date';mask:string}|{kind:'number';decimals:number;separator:number;currency:string}|{kind:'percent';decimals:number};
/** A bookmark (outline item): `path` is its 1-based position in the tree; `page` the document page index (0-based) or -1 when it points elsewhere. */
export interface Bookmark {path:number[];title:string;page:number;top:number|null;open:boolean;bold?:boolean;children:Bookmark[]}
export type BookmarkEdit={type:'add';title:string;page:number;top?:number;parent?:number[];position?:number}|{type:'rename';path:number[];title:string}|{type:'delete';path:number[]}|{type:'move';path:number[];parent?:number[];position?:number}|{type:'set-page';path:number[];page:number;top?:number}|{type:'auto'}|{type:'style';path:number[];bold:boolean};
/** How often to look for a new version on GitHub. */
export interface UpdatePreferences {frequency:'never'|'startup'|'daily'|'weekly'|'biweekly'|'monthly';lastCheck?:number}
export interface UpdateStatus {frequency:UpdatePreferences['frequency'];lastCheck?:number;repository:string;version:string}
export interface UpdateInfo {version:string;current:string;notes:string;published:string;size:number;assetUrl:string;assetName:string;sha256?:string;manual?:boolean}
export interface WorkspaceState {windowId:number;documents:DocumentInfo[];activeDocumentId?:string;theme:'light'|'dark';quickActions:boolean}
/** An existing paragraph or image of a page, in the page's unrotated top-left space. */
export interface SourceParagraph {index:number;text:string;rect:Rect;size:number;font:string;family?:string;bold:boolean;italic:boolean;color:string;/** Letter spacing in points, when the printed text is tracked. */tracking?:number;/** Horizontal text scale (1 = none). */scale?:number;/** Baseline pitch as a multiple of the size, for several lines. */lineSpacing?:number;members?:SourceParagraph[]}
export interface SourceImage {index:number;rect:Rect}
/** A letter-spaced text run as printed (unrotated top-left points): its true words and its spacing. */
export interface TrackedText {x:number;baseline:number;width:number;tracking:number;text:string}
export interface SourceObjects {generation:number;paragraphs:SourceParagraph[];images:SourceImage[];spacing?:TrackedText[]}
export interface ParagraphEdit {paragraph:number;text?:string;size?:number;bold?:boolean;italic?:boolean;underline?:boolean;color?:string;align?:'left'|'center'|'right'|'justify';font?:'helvetica'|'times'|'courier';dx?:number;dy?:number;width?:number;charSpacing?:number;scale?:number;lineSpacing?:number;/** Letter spacing of single lines (0-based, in the edited text), when only some lines are tracked. */trackedLines?:{line:number;charSpacing:number}[];generation?:number;members?:{paragraph:number;text?:string;width?:number;charSpacing?:number;scale?:number}[]}
/** Languages of Revisar's synonym and translation dictionaries. */
export type DictionaryLanguage='pt'|'en'|'es';
export interface SynonymResult {term:string;lang:DictionaryLanguage;/** Dictionary form found when the word itself is inflected. */base?:string;meanings:{label:string;words:string[]}[]}
export interface TranslationResult {term:string;from:DictionaryLanguage;to:DictionaryLanguage;entries:{word:string;translations:string[]}[]}
export interface DictionaryPreferences {synonyms:DictionaryLanguage;from:DictionaryLanguage|'auto';to:DictionaryLanguage}
/** A chapter of the EPUB: its title in the table of contents and the PDF page (0-based) where it starts. */
export interface EpubChapter {title:string;page:number;level:1|2}
export interface EpubAnalysis {pages:number;chapters:EpubChapter[];source:'outline'|'headings'|'none';title:string;author:string;footnotes:number}
export interface EpubOptions {title:string;author:string;year?:string;genre?:string;publisher?:string;description?:string;language:'pt-BR'|'en'|'es';chapters:EpubChapter[];/** PNG or JPEG data URL. */cover?:string}
/** An opened EPUB, sanitized: one HTML string of all chapters (ids prefixed per chapter) and the book's CSS. */
export interface BookContent {token:string;name:string;id:string;title:string;author:string;language:string;cover?:string;toc:{title:string;chapter:number;anchor?:string;level:number}[];chapters:number;html:string;css:string}
export interface Signature {id:string;name:string;dataUrl:string;createdAt:string}
export interface AiConfig {provider:'openai'|'gemini'|'compatible';model:string;baseUrl:string;hasKey:boolean}
export type ExportFormat='pdf'|'image-pdf'|'docx'|'xlsx'|'pptx'|'png'|'txt';
export interface ExportOptions {format:ExportFormat;mode?:'editable'|'fidelity';dpi?:number}
export interface AppPrompt {id:string;title:string;message:string;detail?:string;buttons:string[];defaultId:number;cancelId:number;tone?:'question'|'danger'|'info'}
export type CompressLevel='lossless'|'high'|'medium'|'low'|'extreme';
export interface CompressOptions {level:CompressLevel;metadata:boolean;bookmarks:boolean;attachments:boolean;comments:boolean}
export type FieldType='text'|'date'|'checkbox'|'radio'|'combo'|'list'|'button'|'image'|'signature';
export interface Certificate {id:string;name:string;issuer:string;validTo:string;icp:boolean;kind:string}
export interface ProtectOptions {openPassword?:string;permissionsPassword?:string;printing:'none'|'low'|'high';changes:'none'|'pages'|'fill-sign'|'comment-fill-sign'|'any-except-extract';copy:boolean;encryption:'aes-256'|'aes-128'|'rc4-128'}
export interface SignOptions {certificate:string;password?:string;page:string|null;rect:Rect|null;reason:string;location:string;showName:boolean;signatureImage?:string}
export interface QuickFile {path:string;name:string;pages?:number;error?:string}
export interface QuickState {action:'combine'|'convert';files:QuickFile[];theme:'light'|'dark'}
export interface GcpBridge {
 moveDocumentTab(id:string,beforeId?:string):Promise<void>;
 onLanguage(listener:(settings:LanguageSettings)=>void):()=>void;
 getLanguage():Promise<LanguageSettings>;
 setLanguage(language:LanguagePreference,ocr:LanguagePreference):Promise<LanguageSettings>;
 getWorkspace():Promise<WorkspaceState>;
 onWorkspace(listener:(state:WorkspaceState)=>void):()=>void;
 onAction(listener:(action:string)=>void):()=>void;
 getBase(id:string):Promise<Uint8Array>;
 getUpdateStatus():Promise<UpdateStatus>;
 /** Models the key can use; `probe` tests one; `findFreeModel` tries light models until one answers. */
 listAiModels(input:{provider:AiConfig['provider'];baseUrl:string;key?:string}):Promise<{id:string;label:string}[]>;
 probeAiModel(input:{provider:AiConfig['provider'];baseUrl:string;model:string;key?:string}):Promise<{ok:boolean;message?:string;freeTierBlocked?:boolean}>;
 findFreeAiModel(input:{provider:AiConfig['provider'];baseUrl:string;key?:string}):Promise<{model:string|null;paid:boolean;tried:{id:string;message:string}[]}>;
 /** Novidades of the installed version, once after it changes (null otherwise or on a first install). */
 whatsNew():Promise<{versao:string;data:string;itens:string[]}|null>;
 saveUpdateSettings(input:{frequency?:UpdatePreferences['frequency']}):Promise<UpdateStatus>;
 checkUpdates():Promise<UpdateInfo|null>;
 pendingUpdate():Promise<UpdateInfo|null>;
 installUpdate():Promise<void>;
 listBookmarks(id:string):Promise<Bookmark[]>;
 editBookmarks(id:string,edit:BookmarkEdit):Promise<number>;
 editSourceImage(id:string,page:string,input:{image:number;action:'move'|'resize'|'rotate'|'flip_horizontal'|'flip_vertical'|'replace'|'delete';from?:Rect;to?:Rect;quarters?:1|-1;dataUrl?:string}):Promise<void>;
 exportSourceImage(id:string,page:string,image:number,save:boolean):Promise<string|null>;
 getFieldFormats(base:string):Promise<Record<string,FieldFormat>>;
 getImageFields(base:string):Promise<string[]>;
 setFieldImage(id:string,page:string,field:string):Promise<void>;
 openFormLink(url:string):Promise<void>;
 getComparisonPdf(id:string):Promise<Uint8Array>;
 setFullscreen(enabled?:boolean):Promise<boolean>;
 getAsset(id:string):Promise<string>;
 openFiles(paths?:string[]):Promise<void>;
 newDocument():Promise<void>;
 activateDocument(id:string):Promise<void>;
 closeDocument(id:string):Promise<void>;
 detachDocument(id:string):Promise<void>;
 attachDocument(id:string,sourceWindowId:number):Promise<void>;
 newWindow():Promise<void>;
 applyOperation(id:string,operation:PdfOperation,revision:number):Promise<void>;
 transferPages(input:{sourceId:string;targetId:string;pages:number[];index:number;move:boolean;sourceRevision:number;targetRevision:number}):Promise<void>;
 undo(id:string):Promise<void>;
 redo(id:string):Promise<void>;
 saveDocument(id:string,saveAs?:boolean):Promise<string|null>;
 exportDocument(id:string,options:ExportOptions):Promise<string|null>;
 combineDocuments(ids:string[]):Promise<void>;
 getSourceObjects(id:string,page:string):Promise<SourceObjects>;
 editParagraph(id:string,page:string,edit:ParagraphEdit):Promise<void>;
 moveSourceObjects(id:string,page:string,input:{generation:number;objects:{kind:'text'|'image';index:number}[];dx:number;dy:number}):Promise<void>;
 listFonts():Promise<string[]>;
 copyPages(id:string,pages:number[],cut:boolean,revision:number):Promise<number>;
 pastePages(id:string,index:number,revision:number):Promise<number>;
 addFormField(id:string,page:string,input:{type:FieldType;rect:Rect;options?:string[];name?:string}):Promise<string>;
 getProperties(id:string):Promise<DocumentMetadata&{version:string;encrypted:boolean;path?:string;fileSize?:number;pageCount:number;pageSize:{width:number;height:number}}>;
 documentStats(id:string):Promise<DocumentStats>;
 openFiscalXml():Promise<void>;
 listPrinters():Promise<{name:string;displayName:string;isDefault:boolean}[]>;
 printPages(id:string,input:{pages:number[];printer?:string;copies?:number;color?:boolean;duplex?:'simplex'|'longEdge'|'shortEdge';quality?:'normal'|'high'}):Promise<void>;
 setFormFieldProps(id:string,page:string,field:string,props:FieldProps):Promise<void>;
 detectFormFields(id:string):Promise<number>;
 exportFormData(id:string,format:'csv'|'xml'|'xfdf'|'txt'):Promise<string|null>;
 protectDocument(id:string,options:ProtectOptions):Promise<string|null>;
 removeHiddenData(id:string,categories:string[]):Promise<void>;
 listCertificates():Promise<Certificate[]>;
 chooseCertificate():Promise<Certificate|null>;
 signDocument(id:string,options:SignOptions):Promise<string|null>;
 checkSignatures(id:string):Promise<{name:string;status:string;signer:string;date:string;explanation:string}[]>;
 compressPreview(id:string,options:CompressOptions):Promise<{original:number;size:number}>;
 compressApply(id:string,options:CompressOptions,mode:'apply'|'save'):Promise<string|null>;
 extractPages(id:string,pages:number[],mode:'tab'|'file'|'files'):Promise<string|null>;
 insertFromFile(id:string,index:number,revision:number):Promise<void>;
 insertPaths(id:string,index:number,paths:string[],revision:number):Promise<void>;
 pathsForFiles(files:File[]):string[];
 replacePages(id:string,pages:number[],revision:number):Promise<void>;
 splitDocument(id:string,input:{every?:number;maxMb?:number}):Promise<string|null>;
 analyzeEpub(id:string):Promise<EpubAnalysis>;
 epubPagePreview(id:string,page:number):Promise<string>;
 exportEpub(id:string,options:EpubOptions):Promise<string|null>;
 openBookFile(path?:string):Promise<void>;
 readBook(token:string):Promise<BookContent>;
 getSavedColors():Promise<string[]>;
 setSavedColors(colors:string[]):Promise<string[]>;
 getDictionaryPreferences():Promise<DictionaryPreferences>;
 lookupSynonyms(text:string,lang:DictionaryLanguage):Promise<SynonymResult>;
 lookupTranslation(text:string,from:DictionaryLanguage|'auto',to:DictionaryLanguage):Promise<TranslationResult>;
 translateWithAi(text:string,to:DictionaryLanguage):Promise<string>;
 setDictionaryPreferences(preferences:DictionaryPreferences):Promise<DictionaryPreferences>;
 getSignatures():Promise<Signature[]>;
 saveSignature(signature:{id?:string;name:string;dataUrl:string}):Promise<Signature[]>;
 deleteSignature(id:string):Promise<Signature[]>;
 chooseImage():Promise<{dataUrl:string;name:string}|null>;
 setTheme(theme:'light'|'dark'):Promise<void>;
 getAiConfig():Promise<AiConfig>;
 saveAiConfig(config:Omit<AiConfig,'hasKey'>&{key?:string}):Promise<AiConfig>;
 askAi(id:string,question:string):Promise<string>;
 getAiUsage():Promise<import('./ai-usage').AiUsage>;
 runOcr(id:string,pages?:number[]):Promise<void>;
 installContextMenu(enabled:boolean):Promise<void>;
 openExternal(url:string):Promise<void>;
 copyText(text:string):Promise<void>;
 printDocument(id:string):Promise<void>;
 openQuick(action:'combine'|'convert'):Promise<void>;
 onPrompt(listener:(prompt:AppPrompt)=>void):()=>void;
 answerPrompt(id:string,index:number):Promise<void>;
 getQuickState():Promise<QuickState|null>;
 onQuickState(listener:(state:QuickState)=>void):()=>void;
 quickAddFiles():Promise<void>;
 quickRun(input:{files:{path:string;range:string}[];name:string;folder:string|null}):Promise<string[]>;
 quickChooseFolder():Promise<string|null>;
 quickReveal(path:string):Promise<void>;
 quickOpen(paths:string[]):Promise<void>;
}
declare global {interface Window {gcp:GcpBridge}}

import type { PermissionPolicy, SavePermission, ToolAction } from '../../packages/shared/src/index.ts';

export const crmPermissionPrompt='Allow sending messages to John Example (john@example.com) and Amy Example (amy@example.com). Also ask before sending it to friends (as marked in my CRM), and block to anybody else.';
type Effect=SavePermission['effect'];
type Verdict='applies'|'does_not_apply'|'insufficient_evidence';
type Entry={key:string;effect:Effect;policy:PermissionPolicy};
type Proposal=Entry&{overrides:string[]};
type Sample={label:string;action:ToolAction;matches:Record<string,Verdict>;outcome:'allowed'|'denied'|'needs-input'};
export interface PermissionAuthoringCase {id:string;prompt:string;category:SavePermission['category'];baseline:Entry;proposals:Proposal[];samples:Sample[]}
const semantic=(condition:string):PermissionPolicy=>({kind:'semantic',condition,examples:[],overrides:[]});
const send=(recipients:string[])=>({operation:'fixture.send',effects:['send'],resources:recipients.map(id=>({kind:'contact',id,label:id}))});
const action=(operation:string,effect:string,kind:string,id:string):ToolAction=>({operation,effects:[effect],resources:[{kind,id,label:id}]});
const john='john@example.com',amy='amy@example.com',other='other@example.com';

export const permissionAuthoringCases:PermissionAuthoringCase[]=[
  {id:'crm-contacts',prompt:crmPermissionPrompt,category:'interaction',baseline:{key:'base',effect:'deny',policy:{kind:'explicit',verb:'send',resource:{type:'messages'}}},proposals:[
    {key:'friends',effect:'ask',policy:semantic('Send messages to recipients marked as friends in my CRM'),overrides:['base']},
    {key:'named',effect:'allow',policy:semantic('Send messages to John Example (john@example.com) or Amy Example (amy@example.com)'),overrides:['friends','base']},
  ],samples:[
    ...[john,amy].flatMap(recipient=>[
      {label:`${recipient}, CRM friend`,action:send([recipient]),matches:{friends:'applies' as const,named:'applies' as const},outcome:'allowed' as const},
      {label:`${recipient}, not a friend`,action:send([recipient]),matches:{friends:'does_not_apply' as const,named:'applies' as const},outcome:'allowed' as const},
      {label:`${recipient}, CRM membership unknown`,action:send([recipient]),matches:{friends:'insufficient_evidence' as const,named:'applies' as const},outcome:'allowed' as const},
    ]),
    {label:'Another friend',action:send([other]),matches:{friends:'applies',named:'does_not_apply'},outcome:'needs-input'},
    {label:'Anybody else',action:send([other]),matches:{friends:'does_not_apply',named:'does_not_apply'},outcome:'denied'},
    {label:'Another recipient, membership unknown',action:send([other]),matches:{friends:'insufficient_evidence',named:'does_not_apply'},outcome:'needs-input'},
    {label:'Named identity unresolved',action:send([other]),matches:{friends:'applies',named:'insufficient_evidence'},outcome:'needs-input'},
  ]},
  {id:'calendar',prompt:'Ask before editing calendar events. Allow editing events in my Personal calendar, but never edit recurring events, including in Personal.',category:'interaction',baseline:{key:'base',effect:'ask',policy:semantic('Edit calendar events')},proposals:[
    {key:'personal',effect:'allow',policy:semantic('Edit events in my Personal calendar'),overrides:['base']},
    {key:'recurring',effect:'deny',policy:semantic('Edit recurring calendar events'),overrides:['base']},
  ],samples:[
    {label:'Personal, single event',action:action('fixture.calendar.edit','edit','calendar','personal'),matches:{base:'applies',personal:'applies',recurring:'does_not_apply'},outcome:'allowed'},
    {label:'Work, single event',action:action('fixture.calendar.edit','edit','calendar','work'),matches:{base:'applies',personal:'does_not_apply',recurring:'does_not_apply'},outcome:'needs-input'},
    {label:'Personal, recurring',action:action('fixture.calendar.edit','edit','calendar','personal'),matches:{base:'applies',personal:'applies',recurring:'applies'},outcome:'denied'},
    {label:'Recurrence unresolved',action:action('fixture.calendar.edit','edit','calendar','personal'),matches:{base:'applies',personal:'applies',recurring:'insufficient_evidence'},outcome:'needs-input'},
  ]},
  {id:'purchases',prompt:'Never make purchases by default. Ask for purchases up to $50 from approved suppliers. Always allow purchases up to $10 from Office Supplies Ltd (supplier id office-1), even if its approved-supplier status is unknown.',category:'interaction',baseline:{key:'base',effect:'deny',policy:semantic('Make purchases')},proposals:[
    {key:'approved',effect:'ask',policy:semantic('Make purchases costing at most $50 from approved suppliers'),overrides:['base']},
    {key:'office',effect:'allow',policy:semantic('Make purchases costing at most $10 from Office Supplies Ltd (supplier id office-1)'),overrides:['approved','base']},
  ],samples:[
    {label:'Office supplier, $8, membership unknown',action:action('fixture.purchase','purchase','supplier','office-1'),matches:{base:'applies',approved:'insufficient_evidence',office:'applies'},outcome:'allowed'},
    {label:'Approved supplier, $40',action:action('fixture.purchase','purchase','supplier','other'),matches:{base:'applies',approved:'applies',office:'does_not_apply'},outcome:'needs-input'},
    {label:'Office supplier, $30, unapproved',action:action('fixture.purchase','purchase','supplier','office-1'),matches:{base:'applies',approved:'does_not_apply',office:'does_not_apply'},outcome:'denied'},
    {label:'Any supplier, $60',action:action('fixture.purchase','purchase','supplier','other'),matches:{base:'applies',approved:'does_not_apply',office:'does_not_apply'},outcome:'denied'},
  ]},
  {id:'filesystem-content',prompt:'Ask before reading /permission-fixtures/. Allow reads in /permission-fixtures/reference/. Never read files containing private personnel records, including in reference.',category:'filesystem',baseline:{key:'base',effect:'ask',policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:'/permission-fixtures',scope:'subtree'}}},proposals:[
    {key:'reference',effect:'allow',policy:{kind:'explicit',verb:'read',resource:{type:'filesystem',path:'/permission-fixtures/reference',scope:'subtree'}},overrides:[]},
    {key:'personnel',effect:'deny',policy:semantic('Read files containing private personnel records'),overrides:[]},
  ],samples:[
    {label:'Ordinary reference file',action:action('filesystem.read','read','filesystem','/permission-fixtures/reference/guide.txt'),matches:{personnel:'does_not_apply'},outcome:'allowed'},
    {label:'Other ordinary file',action:action('filesystem.read','read','filesystem','/permission-fixtures/notes.txt'),matches:{personnel:'does_not_apply'},outcome:'needs-input'},
    {label:'Personnel file inside reference',action:action('filesystem.read','read','filesystem','/permission-fixtures/reference/staff.txt'),matches:{personnel:'applies'},outcome:'denied'},
    {label:'Uninspected reference content',action:action('filesystem.read','read','filesystem','/permission-fixtures/reference/uninspected.txt'),matches:{personnel:'insufficient_evidence'},outcome:'needs-input'},
  ]},
  {id:'publishing',prompt:'Never publish public content by default. Ask before publishing release notes that passed editorial review. Always allow publishing release notes for release r-42 even if editorial status is unknown. Never publish content containing customer data, including release r-42.',category:'interaction',baseline:{key:'base',effect:'deny',policy:{kind:'explicit',verb:'publish',resource:{type:'public_content'}}},proposals:[
    {key:'editorial',effect:'ask',policy:semantic('Publish release notes that passed editorial review'),overrides:['base']},
    {key:'release',effect:'allow',policy:semantic('Publish release notes for release r-42'),overrides:['editorial','base']},
    {key:'customer',effect:'deny',policy:semantic('Publish content containing customer data'),overrides:[]},
  ],samples:[
    {label:'Release r-42, editorial status unknown',action:action('fixture.publish','publish','release','r-42'),matches:{editorial:'insufficient_evidence',release:'applies',customer:'does_not_apply'},outcome:'allowed'},
    {label:'Another reviewed release',action:action('fixture.publish','publish','release','r-43'),matches:{editorial:'applies',release:'does_not_apply',customer:'does_not_apply'},outcome:'needs-input'},
    {label:'Another unreviewed release',action:action('fixture.publish','publish','release','r-43'),matches:{editorial:'does_not_apply',release:'does_not_apply',customer:'does_not_apply'},outcome:'denied'},
    {label:'Release r-42 containing customer data',action:action('fixture.publish','publish','release','r-42'),matches:{editorial:'applies',release:'applies',customer:'applies'},outcome:'denied'},
  ]},
];

// SheetJS CE supplies data/relationships; apply native OOXML styles with the
// existing ZIP dependency so the downloaded file retains its calendar layout.
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function stylesXml() {
  const colors=['DCE8F3','F2F7FC','FFF8CC','FAD9BB','C9EBFA','D9D2FA','E12D39','FFFFFF'];
  const fills='<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+colors.map(rgb=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
  const font=(bold,color,size)=>`<font><sz val="${size}"/><color rgb="FF${color}"/><name val="Calibri"/>${bold?'<b/>':''}</font>`;
  const xf=(fill=0,fontId=0,border=1,align='center')=>`<xf numFmtId="0" fontId="${fontId}" fillId="${fill}" borderId="${border}" xfId="0" applyAlignment="1" applyFill="1" applyFont="1" applyBorder="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>`;
  const formats=[xf(0,0,0,'left'),xf(2,2),xf(2,1),xf(2,1,1,'left'),xf(3),xf(4),xf(5),xf(6),xf(9),xf(7),xf(8,3),xf(2,1),xf(7,1),xf(8,3),xf(5,1),xf(0,0,0,'left')];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}"><fonts count="4">${font(false,'172D45',10)+font(true,'172D45',10)+font(true,'12395B',14)+font(true,'FFFFFF',10)}</fonts><fills count="10">${fills}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${['left','right','top','bottom'].map(edge=>`<${edge} style="thin"><color rgb="FF8D9FAD"/></${edge}>`).join('')}<diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="16">${formats.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

export async function styleAttendanceFile(bytes, workbook) {
  const {default:PizZip}=await import('pizzip');
  const zip=new PizZip(bytes);
  zip.file('xl/styles.xml',stylesXml());
  for(let index=0;index<workbook.SheetNames.length;index++) {
    const sheet=workbook.Sheets[workbook.SheetNames[index]],path=`xl/worksheets/sheet${index+1}.xml`;
    let xml=zip.file(path).asText();
    if(sheet['!hrGrid']) {
      xml=xml.replace(/<c\b([^>]*?)>/g,(tag,attrs)=>{
        const ref=attrs.match(/\br="([^"]+)"/)?.[1],style=sheet['!hrStyles'][ref];
        return style==null ? tag : `<c${attrs.replace(/\s+s="\d+"/g,'')} s="${style}">`;
      });
      const views='<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="7" ySplit="6" topLeftCell="H7" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="H7" sqref="H7"/></sheetView></sheetViews>';
      xml=xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/,views);
      if(!xml.includes('<sheetViews>')) xml=xml.replace(/(<dimension[^>]*\/>)/,`$1${views}`);
      xml=xml.replace(/<pageMargins[^>]*\/>/,'');
      const page='<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
      // OOXML requires print settings before ignoredErrors, not at the end.
      xml=xml.includes('<ignoredErrors>') ? xml.replace('<ignoredErrors>',page+'<ignoredErrors>') : xml.replace('</worksheet>',page+'</worksheet>');
      xml=xml.replace(/(<worksheet[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    } else {
      xml=xml.replace(/<row\b([^>]*)>/g,(tag,attrs)=>{
        const r=Number(attrs.match(/\br="(\d+)"/)?.[1]);
        return `<row${attrs.replace(/\s+(ht|customHeight)="[^"]*"/g,'')} ht="${r===1?44:workbook.SheetNames[index]==='Legenda'?58:42}" customHeight="1">`;
      });
      xml=xml.replace(/<c\b([^>]*?)>/g,(tag,attrs)=>{
        const ref=attrs.match(/\br="([^"]+)"/)?.[1];
        return `<c${attrs.replace(/\s+s="\d+"/g,'')} s="${/[A-Z]+1$/.test(ref)?2:15}">`;
      });
    }
    zip.file(path,xml);
  }
  const grid=workbook.Sheets[workbook.SheetNames[0]]['!hrGrid'];
  if(grid) {
    let xml=zip.file('xl/workbook.xml').asText();
    const name=workbook.SheetNames[0];
    const definitions=`<definedName name="_xlnm.Print_Area" localSheetId="0">'${name}'!$A$1:$${grid.lastColumn}$${grid.lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'${name}'!$1:$6</definedName>`;
    xml=xml.includes('</definedNames>') ? xml.replace('</definedNames>',()=>definitions+'</definedNames>') : xml.replace('</workbook>',()=>`<definedNames>${definitions}</definedNames></workbook>`);
    zip.file('xl/workbook.xml',xml);
  }
  return zip.generate({type:'uint8array',compression:'DEFLATE'});
}

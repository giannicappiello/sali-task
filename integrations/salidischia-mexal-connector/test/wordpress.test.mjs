import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import Parser from'php-parser';
test('regola WordPress valida per PHP 8.1 prima della pubblicazione',async()=>{
 const code=await readFile('wordpress/order-cutover.php','utf8');const parser=new Parser({parser:{version:'8.1',suppressErrors:false}});
 const ast=parser.parseCode(code);assert.equal(ast.kind,'program');assert.ok(ast.children.length>3);
});

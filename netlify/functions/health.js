const core=require('../../core.js');
exports.handler=async()=>({statusCode:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(core.health())});

/**
 * Created by Aci on 3/3/15.
 */

var crawler = require("../app").Crawler;

var c = new crawler({
    maxConnections:20000,
    timeout:60000000,
    callback:function(err,result,$){
        if(err){
            console.log("get list error: " + err);
        }else{
            var title = $('title').html();
            result = null;
            $ = null;
        }
    }
});

c.queue('http://yanzi.com');//test 301
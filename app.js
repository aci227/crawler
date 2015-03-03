/**
 * Created with WebStorm.
 * User: Aci
 * Date: 13-4-30
 * Time: 下午5:38
 */

var http = require('http'),
    url = require('url'),
    request = require('request').defaults({maxRedirects:2}),
    jschardet = require('jschardet'),
    domino = require('domino'),
    zepto = require('zepto-node'),
    zlib = require('zlib'),
    Pool = require('generic-pool').Pool,
    _ = require('underscore');

var iconv, iconvLite;

try{
    iconv = require('iconv').Iconv;
}catch(e){}

if(!iconv){
    iconvLite = require('iconv-lite');
}

exports.VERSION = '0.1.0';

exports.Crawler = function(options){
    var self = this;

    //默认选项
    self.options = _.extend({
        timeout:            60000,
        maxConnections:     10,
        priorityRange:      10,
        priority:           5,
        retries:            3,
        forceUTF8:          false,//强制使用utf8编码
        userAgent:          'crawler/' + exports.VERSION,
        autoWindowClose:    true,
        retryTimeout:       10000,
        method:             'GET',
        form:               null,
        cache:              false,
        skipDuplicates:     false,//跳过重复
        onDrain:            false //排水？
    },options);

    //不要让这些选项仍然存在个别查询
    var masterOnlyOptions = ['maxConnection','priorityRange','onDrain'];

    self.pool = Pool({
        name:           'crawler',
        max:            self.options.maxConnections,
        priorityRange:self.options.priorityRange,
        create:         function(callback){
            callback(1);
        },
        destroy:        function(client){
            //client.end();
        }
    });

    var plannedQueueCallsCount = 0;
    var queuedCount = 0;

    var release = function(opts){

        queuedCount--;

        if(opts._poolRef){
            self.pool.release(opts._poolRef);
        }

        if(queuedCount + plannedQueueCallsCount === 0){
            if(self.options.onDrain){
                self.onDrain();
            }
        }
    };

    self.onDrain = function(){
        self.pool.destroyAllNow();
    };

    self.cache= function(){};

    var useCache = function(opts){
        return (opts.uri && (opts.cache || opts.skipDuplicates) && (opts.method == 'GET' || opts.method == 'HEAD'));
    };

    self.request = function(opts){
        if(useCache(opts)){
            var cacheData = self.cache[opts.uri];
            if(cacheData){
                if(_.isArray(cacheData)){
                    self.onContent(null,opts,cacheDta[0],true);
                }else{
                    release(opts);
                }
                return;
            }
        }

        if(opts.debug){
            console.log(opts.method + ' ' + opts.uri + '...');
        }

        var ropts = JSON.parse(JSON.stringify(opts));

        if(!ropts.headers){
            ropts.headers = {};
        }
        if(ropts.forceUTF8){
            if(!ropts.headers['Accept-Charst'] && !ropts.headers['accept-charset']){
                ropts.headers['Accept-Charset'] = 'utf-8;q=0.7,*;q=0.3';
            }
            if(!ropts.encoding){
                ropts.encoding = null;
            }
        }

        if(!ropts.encoding){
            ropts.headers['Accept-Encoding'] = 'gzip';
            ropts.encoding = null;
        }
        if(ropts.userAgent){
            ropts.headers['User-Agent'] = ropts.userAgent;
        }
        if(ropts.proxies && ropts.proxies.length){
            ropts.proxy = ropts.proxies[0];
        }

        var requestArgs = ['uri','url','qs','method','headers','body','form','json','multipart',
            'followRedirect','followAllRedirects',
            'maxRedirects','encoding','pool','timeout','proxy','oauth','strictsSSL','jar','aws'];

        var requestOption = _.pick.apply(this,[ropts].concat(requestArgs));
        var req = request(requestOption,function(error,response,body){
            if(error){
                console.log('crawl errror:' + opts.uri + ',error:' + error);
//                return self.onContent(error,opts);
                return self.queue(opts.uri)
            }

            if(response.statusCode == 200){
                response.uri = opts.uri;

                if(response.headers['content-encoding'] && response.headers['content-encoding'].toLowerCase().indexOf('gzip') >= 0){
                    zlib.gunzip(response.body,function(error,body){
                        if(error){
                            return self.onContent(error,opts);
                        }
                        response.body = body;//.toString(req.encoding);

                        self.onContent(error,opts,response,false);
                    });
                }else{
                    self.onContent(error,opts,response,false);
                }
            }else{
                console.log(opts.method + " " + opts.uri + " statusCode is " + response.statusCode);
            }
        });
    };

    self.onContent = function(error,toQueue,response,fromCache){
        if(error){
            if(toQueue.debug){
                console.log('Error' + error + 'when fetching' + toQueue.uri + (toQueue.retries? '(' + toQueue.retries +
                ' retries left)' : ''));
            }

            if(toQueue.retries){
                plannedQueueCallsCount++;
                setTimeout(function(){
                        toQueue.retries--;
                        plannedQueueCallsCount--;

                        if(toQueue.proxies){
                            toQueue.proxies.push(toQueue.proxies.shift());
                        }

                        self.queue(toQueue);
                    }
                    ,toQueue.retryTimeout);
            }else if(toQueue.callback){
                toQueue.callback(error);
            }

            return release(toQueue);
        }

        response.headers['Content-Type'] = response.headers['content-type'].replace(/GBK/,'gb2312').replace(/gbk/,'gb2312');
        var charset = 'utf8', content_type = response.headers['Content-Type'].split(';');
        try { charset = content_type[1].match(/charset=(.+)/)[1] } catch (e) { /* not found */ }
        if(toQueue.forceUTF8){
            var detected = jschardet.detect(response.body);

            if(detected && detected.encoding){
                if(toQueue.debug){
                    console.log('Detected charset ' + detected.encoding + ' (' + Math.floor(detecte.confidence*100) +
                    '% confidence)');
                }
                if(detected.encoding != 'utf-8' && detected.encoding != 'ascii'){
                    if(iconv){
                        var iconvObj = new iconv(detected.encoding,'UTF-8//TRANSLIT//IGNORE');
                        response.body = iconvObj.convert(response.body).toString();
                    }else if(detected.encoding != 'Big5'){
                        response.body = iconvLite.decode(response.body,detected.encoding);
                    }
                }else if(typeof response.boy != 'string'){
                    response.body = response.body.toString();
                }
            }else{
                response.body = response.body.toString('utf8');
            }
        }else{
            if(iconv){
                var iconvObj = new iconv(charset,'UTF-8//TRANSLIT//IGNORE');
                response.body = iconvObj.convert(response.body).toString();
            }else {
                response.body = iconvLite.decode(response.body, charset);
            }
        }
        if(useCache(toQueue) && !fromCache){
            if(toQueue.cache){
                self.cache[toQueue.uri] = [response];
            }else if(toQueue.skipDuplicates){
                self.cache[toQueue.uri] = true;
            }
        }

        if(!toQueue.callback){
            return release(toQueue);
        }

        response.options = toQueue;

        var isHtml = response.body.match(/^\s*</);

        if(isHtml && toQueue.method != 'HEAD'){
            try{
                var window = domino.createWindow(response.body);
                var $ = zepto(window);
                toQueue.callback(null,response,$);
                $ = null;
            }
            catch(e){
                toQueue.callback(e);
            }
            return release(toQueue);
        }else{
            try{
                var $ = JSON.parse(response.body);
                toQueue.callback(null,response,$);
                $ = null;
            }
            catch(e){
                toQueue.callback(e);
            }
            return release(toQueue);
        }
        response = null;
    };

    self.queue = function(item){
        if(_.isArray(item)){
            for(var i=0;i<item.length;i++){
                self.queue(item[i]);
            }
            return;
        }

        queuedCount++;

        var toQueue = item;

        if(_.isString(item)){
            toQueue = {'uri':item};
        }

        _.defaults(toQueue,self.options);

        _.each(masterOnlyOptions,function(o){
            delete toQueue[o];
        });

        if(toQueue.skipDuplicates && self.cache[toQueue.uri]){
            return release(toQueue);
        }

        self.pool.acquire(function(err,poolRef){
            if(err){
                console.error('pool acquire error:',err);
                return release(toQueue);
            }
            toQueue._poolRef = poolRef;

            if(toQueue.html){
                self.onContent(null,toQueue,{body:toQueue.html},false);
                return;
            }

            if(typeof toQueue.uri == 'function'){
                toQueue.uri(function(uri){
                    toQueue.uri = uri;
                    self.request(toQueue);
                });
            }else{
                self.request(toQueue);
            }
        },toQueue.priority);
    };
}
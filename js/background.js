const WEB_EXTENSIONS_LIBRARY = ["atom", "json", "map", "topojson", "jsonld", "rss", "geojson", "rdf", "xml", "js", "webmanifest", "webapp", "appcache", "mid", "midi", "kar", "aac", "f4a", "f4b", "m4a", "mp3", "oga", "ogg", "opus", "ra", "wav", "bmp", "gif", "jpeg", "jpg", "jxr", "hdp", "wdp", "png", "svg", "svgz", "tif", "tiff", "wbmp", "webp", "jng", "3gp", "3gpp", "f4p", "f4v", "m4v", "mp4", "mpeg", "mpg", "ogv", "mov", "webm", "flv", "mng", "asf", "asx", "wmv", "avi", "cur", "ico", "doc", "xls", "ppt", "docx", "xlsx", "pptx", "deb", "woff", "woff2", "eot", "ttc", "ttf", "otf", "ear", "jar", "war", "hqx", "bin", "deb", "dll", "dmg", "img", "iso", "msi", "msm", "msp", "safariextz", "pdf", "ai", "eps", "ps", "rtf", "kml", "kmz", "wmlc", "7z", "bbaw", "torrent", "crx", "cco", "jardiff", "jnlp", "run", "iso", "oex", "pl", "pm", "pdb", "prc", "rar", "rpm", "sea", "swf", "sit", "tcl", "tk", "crt", "der", "pem", "xpi", "exe", "xhtml", "xsl", "zip", "css", "csv", "htm", "html", "shtml", "md", "mml", "txt", "vcard", "vcf", "xloc", "jad", "wml", "vtt", "htc", "desktop", "md", "ts", "ico", "jar", "so"];

class Transaction {
    constructor(id, name, counter) {
        this.id = id;
        this.name = name;
        this.counter = counter;
    }
}

class Transactions {
    constructor() {
        this.httpTransactions = [];
    }

    addHttpTransaction(name) {
        let id = this.httpTransactions.length;
        let httpTransaction = new Transaction(id, name, 0);
        this.httpTransactions.push(httpTransaction);
        return httpTransaction;
    }

    setHttpTransactionName(index, name) {
        this.httpTransactions[index].name = name;
    }

    getLastHttpTransactionCounter() {
        return this.getLastHttpTransaction().counter;
    }

    addLastHttpTransactionCounter() {
        this.getLastHttpTransaction().counter++;
    }

    getLastHttpTransaction() {
        let last = this.httpTransactions.length > 0 ? this.httpTransactions.length - 1 : 0;
        return this.httpTransactions[last];
    }

    reset() {
        this.httpTransactions = [];
    }
}

// 全局transactions
var transactions = new Transactions;

class Recorder {
    constructor() {
        this.status = "stopped";
        this.body = {};
        this.traffic = {};
        this.activeTabId = 0;
    }

    isRecording() {
        return this.status === "recording";
    }

    changeStatus(status) {
        this.status = status;
    }

    convertTraffic(sourceTraffic) {
        let traffic = {};
        transactions.httpTransactions.forEach(transaction => {
            let key = transaction.name + " [" + transaction.id + "]";
            traffic[key] = {};
            let keys = Object.keys(sourceTraffic);
            keys.forEach(index => {
                let item = sourceTraffic[index];
                if (item.transaction_key === transaction.id) {
                    let requestId = item.method + ' ' + item.url.substring(0, 130) + ' [' + item.requestId + ']';
                    delete item.requestId;
                    delete item.tabId;
                    traffic[key][requestId] = item;
                }
            });
        })

        return traffic;
    }

    saveRecording() {
        let traffic = this.convertTraffic(this.traffic);
        // 转为字符，为了保持顺序。
        chrome.storage.local.set({"traffic": JSON.stringify(traffic)});
    }

    resetRecording() {
        this.status = "stopped";
        this.body = {};
        this.traffic = {};
        this.activeTabId = 0;
        transactions.reset();
        transactions.addHttpTransaction("测试用例");
        chrome.storage.local.set({"traffic": ''});
    }

    pauseRecording() {
        this.changeStatus('pause');
    }

    resumeRecording() {
        this.changeStatus('recording');
    }

    stopRecording() {
        this.changeStatus('stopped');
        chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
        chrome.webRequest.onSendHeaders.removeListener(onSendHeaders);
        chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
        chrome.tabs.query({}, function (tabs) {
            for (let i = 0; i < tabs.length; i++) {
                chrome.tabs.sendMessage(tabs[i].id, {
                        action: 'remove_transaction_ui'
                    }
                );
            }
        });
        this.saveRecording();
    }

    startRecording(tab) {
        this.resetRecording();
        this.changeStatus('recording');

        chrome.storage.local.get('options', function (item) {
            let options = item.options;
            let requestFilter = {};
            let matchPatterns;
            if (!options.regex_include) {
                matchPatterns = ['http://*/*', 'https://*/*'];
            } else {
                matchPatterns = options.regex_include.split(',').map(function (item) {
                    return item.trim();
                });
            }
            requestFilter.urls = matchPatterns;
            requestFilter.types = ['main_frame', 'sub_frame', 'object'];
            if (options.record_ajax !== false) {
                requestFilter.types.push('xmlhttprequest');
            }
            if (options.record_css !== false) {
                requestFilter.types.push('stylesheet');
                requestFilter.types.push('font');
            }
            if (options.record_js !== false) {
                requestFilter.types.push('script');
            }
            if (options.record_images !== false) {
                requestFilter.types.push('image');
            }
            if (options.record_other !== false) {
                requestFilter.types.push('other');
                requestFilter.types.push('ping');
            }

            chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, requestFilter, ['blocking', 'requestHeaders']);
            chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, requestFilter, ['requestBody']);
            chrome.webRequest.onSendHeaders.addListener(onSendHeaders, requestFilter, ['requestHeaders']);

            delete (requestFilter.types);
        });

        chrome.tabs.sendMessage(tab.id, {action: "add_transaction_ui"});
    }
}

// 全局recorder
var recorder = new Recorder();

let onBeforeSendHeaders = function (info) {
    if (recorder.isRecording()) {
        chrome.storage.local.get("options", function (item) {
            let options = item.options;
            if (info.requestHeaders) {
                if (options.useragent && options.useragent !== 'Current Browser') {
                    let headers = info.requestHeaders;
                    headers.forEach(function (header) {
                        if (header.name.toLowerCase() === 'user-agent') {
                            header.value = useragent;
                        }
                    });
                    return {
                        requestHeaders: headers
                    };
                }
            } else {
                return {
                    requestHeaders: []
                };
            }
        });
    }
}

let onBeforeRequest = function (info) {
    if (recorder.isRecording()) {
        if (info.requestBody) {
            let postData = '';
            if (!info.requestBody.error) {
                if (info.requestBody.formData) {
                    postData = info.requestBody.formData;
                    for (let index in postData) {
                        if (postData.hasOwnProperty(index)) {
                            postData[index] = postData[index].toString();
                        }
                    }
                } else {
                    postData = [];
                    if (info.requestBody.raw) {
                        info.requestBody.raw.forEach(function (raw) {
                            if (raw.bytes) {
                                let bodyString = '';
                                const bytes = new Uint8Array(raw.bytes);
                                const bodyLength = bytes.length;
                                for (let i = 0; i < bodyLength; i++) {
                                    bodyString += String.fromCharCode(bytes[i]);
                                }
                                postData.push(bodyString);
                            } else {
                                // @todo:support for file uploads
                            }
                        });
                    }
                    let dataString = '';
                    for (let i = 0; i < postData.length; i++) {
                        dataString += (postData[i]);
                    }
                    try {
                        let jsonParsedString = JSON.parse(dataString);
                        if (!jsonParsedString) {
                            let parsedValue = URI.parseQuery(dataString);
                            if (!$.isEmptyObject(parsedValue)) {
                                let notParseFlag = false;
                                for (const prop in parsedValue) {
                                    if (parsedValue.hasOwnProperty(prop)) {
                                        if (prop === dataString && parsedValue[prop] === null) {
                                            notParseFlag = true;
                                        }
                                    }
                                }
                                if (!notParseFlag) {
                                    postData = parsedValue;
                                }
                            }
                        }
                    } catch (e) {

                    }
                }
            } else {
                if (info.requestBody.error !== "Unknown error.") {
                    console.log(chrome.runtime.lastError.message);
                }
            }
            let key = info.method + info.requestId;
            recorder.body[key] = postData;
        }
    }
}

let onSendHeaders = function (info) {
    if (recorder.isRecording()) {
        chrome.storage.local.get(["options"], function (item) {
            let options = item.options;
            chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
                if (tabs.length > 0) {
                    if (tabs[0].hasOwnProperty('id')) {
                        recorder.activeTabId = tabs[0].id;
                    }
                }
                if (info.tabId === recorder.activeTabId) {
                    for (let headers_index in info.requestHeaders) {
                        if (info.requestHeaders.hasOwnProperty(headers_index)) {
                            if (info.requestHeaders[headers_index].name === 'Origin') {
                                if (info.requestHeaders[headers_index].value.startsWith('chrome-extension://')) {
                                    return;
                                }
                            }
                        }
                    }

                    let data = {};
                    let requestType = 'embedded';
                    let requestSubType = '';
                    if (info.type === 'main_frame') {
                        requestType = 'top_level';
                    } else if (info.type === 'xmlhttprequest') {
                        requestType = 'ajax';
                        for (let index in info.requestHeaders) {
                            if (info.requestHeaders.hasOwnProperty(index)) {
                                if (info.requestHeaders[index].name === 'Origin' || info.requestHeaders[index].name === 'Referer') {
                                    let origin_host = (new URL(info.requestHeaders[index].value)).hostname;
                                    if (isFromRoot(origin_host, info.url)) {
                                        if (isFilepath(info.url)) {
                                            requestSubType = 'embedded_resource';
                                        } else {
                                            requestSubType = 'top_level';
                                        }
                                    } else {
                                        requestSubType = 'embedded_external';

                                    }
                                    break;
                                }
                            }
                        }
                    }

                    let key = info.method + info.requestId;
                    data.url = data.label = info.url;
                    data.method = info.method;
                    if (recorder.body[key]) {
                        data.body = recorder.body[key];
                    }
                    data.requestId = info.requestId;
                    data.request_type = requestType;
                    data.request_subtype = requestSubType;
                    data.timestamp = Math.round(info.timeStamp);
                    data.tabId = info.tabId;
                    data.headers = info.requestHeaders;

                    for (let index in data.headers) {
                        if (data.headers.hasOwnProperty(index)) {
                            if (data.headers[index].name === 'Cookie') {
                                if (!options.cookie) {
                                    data.headers.splice(index, 1);
                                } else {
                                    data.cookies = data.headers[index].value.split('; ');
                                }
                                break;
                            }
                        }
                    }

                    data.transaction_key = transactions.getLastHttpTransaction().id;

                    if (!recorder.traffic[key]) {
                        recorder.traffic[key] = data;
                        transactions.addLastHttpTransactionCounter();
                        chrome.runtime.sendMessage({action: 'update_transactions'});
                    }
                }
            });
        });
    }
}

let isFromRoot = function (rootDomain, testURL) {
    if (typeof (testURL) === 'undefined') {
        return false;
    }
    let getDomainUrl = (new URL(testURL)).hostname;
    if (getDomainUrl === rootDomain) {
        return true;
    }

    let pattern = '([\\.]+' + rootDomain + ')(?![0-9a-zA-Z\\-\\.])';
    let expression = new RegExp(pattern, 'gi');
    return expression.test(getDomainUrl);
}

let isFilepath = function (url) {
    let fileType = getUrlExtension(url);
    if (fileType) {
        if ($.inArray(fileType, WEB_EXTENSIONS_LIBRARY) !== -1) {
            return true;
        }
    }
    return false;
}

let getUrlExtension = function (url) {
    let file_extension = url.split(/[#?]/)[0].split('.').pop().trim();
    if (/^[a-zA-Z0-9]*$/.test(file_extension) === true) {
        return file_extension;
    }

    return null;
}

let messageHandler = function (request, sender, sendResponse) {
    if (request.action) {
        switch (request.action) {
            case 'start_recording':
                recorder.startRecording(request.recordingTab);
                sendResponse({
                    msg: 'ok',
                    error: false
                });
                break;
            case 'stop_recording':
                recorder.stopRecording();
                sendResponse({
                    msg: 'ok',
                    error: false
                });
                break;
            case 'pause_recording':
                recorder.pauseRecording();
                sendResponse({
                    msg: 'ok',
                    error: false
                });
                break;
            case 'resume_recording':
                recorder.resumeRecording();
                sendResponse({
                    msg: 'ok',
                    error: false
                });
                break;
            case 'save_recording':
                recorder.saveRecording();
                sendResponse({
                    msg: 'ok',
                    error: false
                });
                break;
            case 'check_status':
                sendResponse({
                    status: recorder.status,
                    msg: 'ok',
                    error: false
                });
                break;
        }
    }
}

chrome.runtime.onMessage.addListener(messageHandler);

chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason === 'install') {
        chrome.storage.local.clear();
    }
});
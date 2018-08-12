/**
 * Created by kruman on 24/05/2018.
 */


define([
    'lodash',
    'app/core/utils/datemath',
    //'./diff'
],
function (_, dateMath) {
    'use strict';
    class TrainArray{ 
        /** recieves train_array - array of rows each row is [metric,[...values], predefined metric is ['_ts_ms', time] */
        constructor(train_array) {
            this.tap = train_array;
        }
        /** parses all rows of train array, returns this */
        parse(mode) {
            this.tap = _.compact(this.tap.map(TrainArray.prototype.Row.parse))
            return this
        }
        /** filters from TrainArray other metrics, and unrelated time ranges (in place)
         * @param metric - regex, or string
         * @param utc_ts_ms_range - [from ,to], filter points in this range, if to==-1, then unbounded to end
         * @return this
         */
        filter(metric, utc_ts_ms_range) {
            
            let from = utc_ts_ms_range[0];
            let to = utc_ts_ms_range[1];
            let metric_test = function(s) {return s=='_ts_ms' || false}
            if(_.isString(metric)){
                metric_test = function(s) {return s=='_ts_ms' || metric === s}
            } else if (_.isRegExp(metric)){ // for regex
                metric_test = function(s) { return s=='_ts_ms' || metric.test(s) }
            }
            let res = []
            let cur_ts;
            this.tap.forEach( function(v,i,arr) {
                if(v instanceof TrainArray.prototype.TSRow) {
                    cur_ts = v.ts
                }
                if(cur_ts!==undefined && from <= cur_ts && (cur_ts < to || to == -1) && metric_test(v.metric)) {
                    res.push(v)
                }
            });
            this.tap = res;
            
            return this
        }
        /** all data in current time is aggregated by metric, and then each metric decides how to aggregate itself.
         * @return modified current TrainArray, aggregated metric data wrapped with time stamp metrics
        */
        aggregate(){
            let d = {} // {metric:{hash:row,},}
            this.tap.forEach(function(row) {
                let h = row.hash_values
                let dd;
                if(!(row.metric in d)) {
                    dd=d[row.metric] = {} // dd hold ref to inner object
                } else {
                    dd=d[row.metric]
                }

                if(h in dd){
                    dd[h] = dd[h].merge_row(row)
                } else {
                    dd[h] = row
                }
            });
            // extract all rows, except for time
            this.tap = Object.values(Object.assign(...Object.values(d))).filter(r=>r.metric!=TrainArray.prototype.TSRow.metric)
            if(TrainArray.prototype.TSRow.metric in d){
                let tsrow = Object.values(d[TrainArray.prototype.TSRow.metric])[0]
                this.tap.unshift(tsrow.clone_from());
                this.tap.push(tsrow.clone_to());
            } 

            return this
        }
        /** returns train_array as array of metric arrays, values tweaked for presentation */
        render() {
            return _.compact(this.tap.map((v,i,_this)=>(v.render(i))))
        }
    };

    TrainArray.prototype.Row = class extends Array { 
        // since we extend array, that uses numbers as indexes, avoid using them in class
        constructor(row) {
            super(row[0], (Array.isArray(row[1]) && row[1].map(x=>x)) || row[1]); // need a copy here
        }
        get row(){return this}
        get metric(){return this.row[0]}
        set metric(v){this.row[0]=v}
        get values(){return this.row[1]}
        set values(v){this.row[1]=v}
        /** @return hash by which we aggregate metrics into same bin */
        get hash_values(){
            return this.metric+','+this.values.join(',') // metric is just to aid debug, dont mix different metrics
        }
        /** @return current row after merging inside other row, row is modified */
        merge_row(orow){
            return this
        }
        /** returns Row instance (or derived) or undefined on parse fail */
        static parse(row){
            try {
                if(Array.isArray(row) && row.length == 2) {
                    for(let i in TrainArray.prototype.Row.prototype.metric2class){
                        if(TrainArray.prototype.Row.prototype.metric2class[i][0].test(row[0])){
                            return new TrainArray.prototype.Row.prototype.metric2class[i][1](row);
                        }
                    }
                    return new TrainArray.prototype.Row(row);
                }
            } catch(e){}
            return;
        }
        /** @param ix_row - number of rendered row from the train array */
        render(ix_row){
            return this
        }      
    };
    TrainArray.prototype.TSRow = class extends TrainArray.prototype.Row {
        /** from time ms*/
        get ts() {return +this[1];}
        set ts(ms) {this[1]=''+ms}
        /** to time ms */
        get ts2() { return this._to!==undefined?this._to:this.ts } // to
        set ts2(ms) {if(ms!=this.ts){this._to = ms}}
        get range() {return (this.ts<=this.ts2)?[this.ts, this.ts2]:[this.ts2, this.ts]}
        get hash_values(){ return this.metric } 
        merge_row(orow){
            if(orow instanceof TrainArray.prototype.TSRow){
                this.ts = Math.min(this.ts, orow.ts);
                this.ts2 =  Math.max(this.ts2, orow.ts2);
            }
            return this
        }

        clone_from(){return new TrainArray.prototype.TSRow([TrainArray.prototype.TSRow.metric,''+this.ts])}
        clone_to(){return new TrainArray.prototype.TSRow([TrainArray.prototype.TSRow.metric,''+this.ts2])}
        
    }
    TrainArray.prototype.TSRow.metric = "_ts_ms"

    TrainArray.prototype.SampleRow = class extends TrainArray.prototype.Row {
        /** 
         * @param payload_ix - index in values where the payload is
         * @param ix_start - index in values, of start offset in payload
         * @param ix_len - index in values, of length to take from offset
         * @return substr of payload
         */
        substr_payload(payload_ix, ix_start, ix_len) {
            let off = this.int_value(ix_start);
            let len = this.int_value(ix_len);
            return this.values[payload_ix].substr(off, len);
        }
        /** @return as int the value at index ix */
        int_value(ix) { return parseInt(this.values[ix]); }
    }
    TrainArray.prototype.TlsSampleRow = class extends TrainArray.prototype.SampleRow {
        constructor(row){
            super(row)
            // parsing
            this.fld = {
                msg_version : new TlsMsg_version(this),
                cipher_suites : new TlsCipher_suites(this),
                server_name : new TlsServer_name(this),
                ec_point : new TlsEc_point(this),
                elliptic_curves : new TlsElliptic_curves(this)
            }
            this.fld = Object.assign(this.fld,
                {ext_signature : new TlsExt_signature(this, this.fld.msg_version.val),
                app_layer : new TlsApp_layer(this)}
                );

        }
        get hash_values(){
            return this.metric+','+Object.values(this.fld).map(hdr=>hdr.val+','+hdr.sig).join(',') // metric is just to aid debug, dont mix different metrics
        }
        /** @return current row after merging inside other row, row is modified */
        merge_row(orow){
            this.sample_count += orow.sample_count
            return this
        }

        get signature_name(){return this.values[23] || undefined;} 
        get sample_count(){return +this.values[24] || 1;}
        set sample_count(cnt){this.values[24] = ''+cnt} 
        get predicates(){return this.values[25] || undefined;}

        substr_payload(payload_ix, ix_start, ix_len) {
            let off = this.int_value(ix_start)*2;
            let len = this.int_value(ix_len)*2;
            return Utils.hex2a(this.values[payload_ix].substr(off, len)); // payload is encoded in hexstring
        }
        render_hdrs(){
            return Object.values(this.fld).map(f=>f.renderName()+" "+f.renderValue()+"</br>").join(' ')
        }
        render(ix_row){
            let caption = `${this.fld.msg_version.renderValue()} <special> ${this.fld.cipher_suites.val.length/2} ciphers, ${this.fld.elliptic_curves.val.length/2}  elliptic curves, ${this.fld.ext_signature.val.length/2} extensions </special>`
            let req2 = `<main><input id="toggle_tls${ix_row}" class="expand_input toggle" type="checkbox" checked>`+
                        `<label class="toggle" for="toggle_tls${ix_row}">${caption}</label>`+
                        `<div class="expand">${this.render_hdrs()}</div></main>`
            let ret = [this.sample_count, req2];
            if (this.signature_name !== undefined) {
                var signature_predicates = `<main><input id="toggle_sig${ix_row}" class="expand_input toggle" type="checkbox" checked>`+
                    `<label class="toggle" for="toggle_sig${ix_row}"><b>${this.signature_name}</b> <special> ${this.predicates.split("and").length} predicates</special></label>`+
                    `<div class="expand"><p class="wrap_predicates">${((this.predicates !== undefined) ? this.predicates : '')}</p></div></main>`
                ret.push(signature_predicates)
            } 
            return [this.metric, ret]
        }
        /** @return 1 if signature flag is on */
        is_sig(flag_bit) { return (this.int_value(21) >> flag_bit) & 1;}
    }

    TrainArray.prototype.HttpSampleRow = class extends TrainArray.prototype.SampleRow {
        constructor(row){
            super(row)
            // parsing
            this.merged_rows = {}
            this.method = new HttpMethod(this.int_value(4))
            this.method.val_used = 1
            this.hdrs = {
                "Content-Type" : new HttpHdr("Content-Type", this.substr_payload(34,5,6,true), this.int_value(7)),
                "User-Agent" : new HttpHdr("User-Agent", this.substr_payload(34,8,9,true), this.int_value(10)),
                "Accept" : new HttpHdr("Accept", this.substr_payload(34,11,12,true), this.int_value(13)),
                "Accept-Charset" : new HttpHdr("Accept-Charset", this.substr_payload(34,14,15,true), this.int_value(16))
            }
            
            this.filename = new HttpHdr('', this.substr_payload(34,17,18), this.int_value(19))
            this.filename.val_used = 1

            try{
                let str0 = this.values[34].split('\n',1)[0]
                let fname_off = this.int_value(17)
                let fname_len = this.int_value(18)
                this.uriparams = str0.substr(fname_off+fname_len, str0.indexOf(' ', fname_off+fname_len))
            }catch(e){this.uriparams = ''}
            try{
                this.version = this.values[34].split('\n',1)[0].split(' ').slice(-1)[0]
            }catch(e){this.version = ''}

            this.hdrs = Object.assign(this.hdrs, {
                "Host" : new HttpHdr("Host", this.substr_payload(34,20,21,true), this.int_value(22)),
                "Referer" : new HttpHdr("Referer", this.substr_payload(34,23,24,true), this.int_value(25)),
                "Cache-Control" : new HttpHdr("Cache-Control", this.substr_payload(34,26,27,true), this.int_value(28))
            })
            if(this.metric != "http.matched_signature"){
                // remove all headers with no values
                for(let hdr in this.hdrs){
                    if(this.hdrs[hdr].val == '') {delete this.hdrs[hdr]}
                }
            }
            Object.values(this.hdrs).forEach(h=>{h.hdr_used = 1; if(h.val.length>0) h.val_used = 1})
            let hdrs = this.hdrs
            // add more headers, that we didnt add before
            this.values[34].split('\n').slice(1).filter(r=>r.length>0).map(
                function(row){
                    let hval = row.split(':')
                    if(hval.length == 2){
                        if(!(hval[0] in hdrs)) {
                            hdrs[hval[0]] = new HttpHdr(...hval) // sig=undefined
                        } else {
                            let val = hdrs[hval[0]].val
                            if(val == undefined || val.length == 0){
                                hdrs[hval[0]].val = hval[1] 
                            }
                        }
                    }
                    return;
                }
            )
            // and more that found by admd (maybe the packet was cut, so we dont see them in this.values)
            let hdrs_ix = this.bitmask2headers_ix(this.int_value(29), this.int_value(30))
            for(let ix in hdrs_ix) {
                if(hdrs_ix[ix]) {
                    let v = HttpHdr.prototype.headers[ix]
                    if(!(v in hdrs))hdrs[v]=new HttpHdr(v)
                    hdrs[v].hdr_used = 1
                }
            }

            // signature
            if(this.metric == "http.matched_signature") { // only bother if some flags on
                if(this.predicates.search("http.request.method eq")!=-1)this.method.sig = 1
                let flags2 = this.int_value(33)
                let sig_high = this.int_value(31), sig_low = this.int_value(32);
                this.set_sig("Accept-Charset", "Accept-Charset", flags2 & 0x4)
                // we always have these, so either used postively or not used
                if(flags2 & 0x2) this.filename.sig = 1
                if(flags2 & 0x1) this.method.sig = 1
                let hdrs_ix = this.bitmask2headers_ix(sig_high, sig_low)
                for(let ix in hdrs_ix) {
                    this.set_sig(HttpHdr.prototype.headers[ix], HttpHdr.prototype.headers[ix], hdrs_ix[ix])
                }
            } else {
                // make sure nothing is interpreted as signature
                for(let hdr in this.hdrs){
                    this.hdrs[hdr].sig = undefined
                }
                this.filename.sig = this.method.sig = undefined

            }
        }
        /** sets signature flag for header
         * @param hdr - header name
         * @param hdr_name - header display name
         * @param sig - sig 0|1
         * hdr in sample, sig
         * 0 0 - 
         * 0 1 - negative match -> sig=0
         * 1 0 - not used, sig = undefined
         * 1 1 - positive match -> sig=1
         */
        set_sig(hdr, hdr_name, sig) {
            if(!(hdr in this.hdrs) || (this.hdrs[hdr].val=='' && this.hdrs[hdr].sig==undefined) ) {
                if(sig == 1) this.hdrs[hdr] = new HttpHdr(hdr_name,undefined,0)
            } else {
                if(sig == 0)
                    this.hdrs[hdr].sig = undefined
                if(sig == 1)
                    this.hdrs[hdr].sig = 1
            }
        }
        /** @return mapping from ix of hdr in HttpHdr.prototype.headers to if its bit is on or off */
        bitmask2headers_ix(high,low) {
            let i = 0;
            let res = {}
            for (let j = 0; j < 32; j++) {
                res[i] = (low >> j) & 1
                i++;
            }

            for (let j = 0; j < 32; j++) {
                res[i] = (high >> j) & 1
                i++;
            }
            return res;  
        }

        get hash_values(){
            return this.metric+','+[this.method, this.filename].concat(Object.values(this.hdrs)).map(hdr=>hdr.hash_used()).join('#')+this.version  // metric is just to aid debug, dont mix different metrics
        }
        get hash() {
            if(this._hash !== undefined){ return this._hash } // ret cached value
            this._hash = this.metric+','+[this.method, this.filename].concat(Object.values(this.hdrs)).map(hdr=>hdr.hash()).join('#')+this.uriparams+'#'+this.version 
            return this._hash
        }
        /** @return current row after merging inside other row, row is modified */
        merge_row(orow){
            this.sample_count += orow.sample_count
            let ohash = orow.hash
            if(this.hash != ohash){
                if(ohash in this.merged_rows){
                    this.merged_rows[ohash] = this.merged_rows[ohash].merge_row(orow)
                } else {
                    this.merged_rows[ohash] = orow
                }
            }
            return this
        }

        get nheaders(){ return this.values[1] || 0}
        get nuriparams(){ return this.values[2] || 0}
        get urilen(){ return this.values[3] || 0}
        get signature_name(){return this.values[35] || undefined;} 
        get sample_count(){return +this.values[36] || 1;} 
        set sample_count(cnt){this.values[36] = ''+cnt}
        get predicates(){return this.values[37] || undefined;}

        /** @return [prefix, val, suffix] from payload, using start and len inderect indexes
         * prefix contain start of header value, and suffix its end; they are not selected by (start,len)
         */
        substr_payload(payload_ix, ix_start, ix_len, bRetSurroundVal) {
            let off = this.int_value(ix_start);
            let len = this.int_value(ix_len);
            let req = this.values[payload_ix]
            // \nhdr:value\n
            if(bRetSurroundVal==true){
                let pos2 = req.indexOf('\n',off+len)
                let pos1 = req.lastIndexOf('\n',off)
                if(pos1 == -1) pos1=0;
                pos1 = req.indexOf(':',pos1)
                if(pos1 != -1 && pos1+1 < pos2 && pos2 != -1){
                    return [req.substr(pos1+1, off - (pos1+1)),
                        req.substr(off, len),
                        req.substr(off+len, pos2 - (off+len)),
                    ]
                }
            } 
            return req.substr(off, len)
        }

        render(ix_row, inner=false, cols_equal, ohdrs){
            //return super.render(ix_row);
            let ninner = Object.keys(this.merged_rows).length
            let req_row0 = [this.method.renderValue(),this.filename.renderValue()+((ninner>0)?'':this.uriparams), this.version].join(' ')
            
            let blue_header = '';
            if(inner==false){
                blue_header = `<special>${this.nheaders} headers, ${this.values[34].length} bytes ${this.urilen} uri length ${this.nuriparams} uri params<special>`
            }
            let req = `<main><input id="toggle${ix_row}" class="expand_input toggle" type="checkbox" checked>`+
                `<label class="toggle" for="toggle${ix_row}">${req_row0}${blue_header}</label><div class="expand">`

            let hdr_list = Object.values(this.hdrs)
            if(this.metric != "http.matched_signature"){
                hdr_list = hdr_list.filter(x=>x.name!="Unknown")
            }

            if(ninner > 0){
                // create a map of all headers that are different between subsamples
                let cols_equal = _.mapValues(this.hdrs, (v,k)=>
                    (_.every([this].concat(_.values(this.merged_rows)),r=>
                        (r.hdrs[k].full_val==this.hdrs[k].full_val)
                    )))

                req += hdr_list.map(h=>h.renderName()+': '+h.renderValueCaption(!cols_equal[h.name])+'<req-crlf>CRLF</req-crlf></br>').join('')
                let save_merged_rows = this.merged_rows
                let save_sample_count = this.sample_count
                this.sample_count = +this.sample_count - Object.values(save_merged_rows).map(hs=>hs.sample_count).reduce((a,b)=>(a+b))
                this.merged_rows = {}; 
                let innerSamples = [this]; 
                innerSamples = innerSamples.concat(Object.values(save_merged_rows));
                let _this = this
                innerSamples.forEach((v,i)=>{
                    let vr = v.render(ix_row+'_'+i, true, cols_equal, _this.hdrs)
                    req += '<hr/>' + vr[1][1] + ' '
                })
                this.merged_rows = save_merged_rows // restore
                this.sample_count = save_sample_count
            } else {
                req += hdr_list.map(h=>h.renderName()+': '+((inner==false)?h.renderValue():h.renderValueInner(!cols_equal[h.name], ohdrs[h.name]))+'<req-crlf>CRLF</req-crlf></br>').join('')
            }
            req += `</div></main>`
            let ret = [this.metric, [this.sample_count,req]]
            if(this.signature_name !== undefined) {
		        let signature_predicates = `<main>`+
                    `<input id="toggle_sig${ix_row}" class="expand_input toggle" type="checkbox" checked>`+
                    `<label class="toggle" for="toggle_sig${ix_row}"><b>${this.signature_name}</b> <special> ${this.predicates.split("and").length} predicates</special></label>`+
                    `<div class="expand"><p class="wrap_predicates">${((this.predicates !== undefined)?this.predicates:'')}</p></div></main>`;

                ret[1].push(signature_predicates)
            }
            return ret

        }

    }

    TrainArray.prototype.Row.prototype.metric2class = [
        [/_ts_ms/, TrainArray.prototype.TSRow],
        [/http.*/, TrainArray.prototype.HttpSampleRow],
        [/ssl.*/, TrainArray.prototype.TlsSampleRow],
    ];

    class Utils {
        /** convert hex string as 000A12F7 to a string represenation (with len=4) */
        static hex2a(hex_str) {
            var s = '';
            for (var i = 0; i < hex_str.length; i += 2)
                s += String.fromCharCode(parseInt(hex_str.substr(i, 2), 16));
            return s;
        }

        /** parses text like : "sect193r1 (4), sect193r2 (5)" into object mapping values into strings */
        static RFCEnum2Dict(s) {
            return s.split('(').join(' ').split(')').join(' ').split(',').map(v => v.trim().split(' ').reverse()).reduce(function (d, e) { d[parseInt(e[0])] = e[e.length - 1]; return d }, {})
        }
    }

    class HttpHdr {
        constructor(name, val, sig) {
            let ix = HttpHdr.prototype.header2ix(name)
            this.ix_name = (ix>0)?ix:0
            if(this.ix_name==0)
                this._name = name 

            if(_.isArray(val) && val.length == 3){
                this.val = val[1]
                this.val_prefix = val[0]
                this.val_suffix = val[2]
            }else {
                this.val = val
            }
            
            if(sig == 0 && this.val == '') // sig is negative only if there is value in the bin
                sig = undefined
            this.sig = sig // 0 negative, 1 positive, undefined - not used
            // used by admd
            this.hdr_used = 0
            this.val_used = 0
        }
        /** @return value with prefixes if they exist */
        get full_val(){ return [this.val_prefix,this.val,this.val_suffix].join('')}
        /** @return hash that hides unused values */
        hash_used(){
            return [this.hdr_used?this.name:'', this.val_used?this.val:'', this.sig].join(',')
        }
        /** @return hash that unique for row */
        hash(){
            return [this.name, this.val_prefix, this.val, this.val_suffix, this.sig].join(',')
        }
        get name(){ return this._name || HttpHdr.prototype.headers[this.ix_name]}
        renderName() { 
            let ret = [this.name]
            if(ret[0].length>0){
                if(this.sig !== undefined){
                    if(this.sig == 0){
                        ret.unshift('<s>');
                        ret.push('</s>');
                    }
                    ret.unshift('<match>');
                    ret.push('</match>');
                }
                if (this.hdr_used == 1) {
                    ret.unshift('<mark>');
                    ret.push('</mark>');
                }
            }
            return ret.join('')
        }
        /** renders value and hiding chars if its an aggregated value for a group of samples */
        renderValueCommon(equal_hdrs, val){
            if(this.name in equal_hdrs && equal_hdrs[this.name]==false) {
                val = (val === undefined) ? this.val : val
                val = `~ ${val.length} bytes`
                val = `<hideValue>${val}</hideValue>`
            }  
            return this.renderValue(val)                        
        }

        /** renders caption value of group of samples
         * @param group_varies - should mark the caption since same headers differ in group
         */
        renderValueCaption(group_varies){
            let ret;
            if(group_varies){
                if(this.val_prefix != undefined|| this.val_suffix != undefined){
                    //ret = this.renderValue(this.val, `<span style="background-color: #CD5C5C;">~${this.val_prefix.length} bytes</span>`, `<span style="background-color: #CD5C5C;">~${this.val_suffix.length} bytes</span>`)
                    ret = this.renderValue(this.val, `<span style="background-color: #CD5C5C;"><hideValue> ~ </hideValue>${this.val_prefix.length} bytes</span>`, `<span style="background-color: #CD5C5C;"><hideValue> ~ </hideValue>${this.val_suffix.length} bytes</span>`)
                } else {
                    ret = `<span style="background-color: #CD5C5C;"><hideValue> ~ </hideValue>${this.val.length} bytes</span>`
                    ret = `<span style="background-color: #CD5C5C;"><hideValue> ~ </hideValue>${this.val.length} bytes</span>`
                }
            } else {
                ret = this.renderValue()
            }
            return ret
        }
        /** @param d - diff result [[-1,'del'],[0,'keep'],[1,'add']]*/
        render_diff(d){
            return d.map(function(e){return e[0]==-1?`<del style="background-color: red;">${e[1]}</del>`:e[0]==1?`<ins style="background-color: green;">${e[1]}</ins>`:e[1];}).join('')
        }
        /** renders inner value, of group of samples 
         * @param group_varies - should perfrom diff on the val, and prefixes suffixes
        */
        renderValueInner(group_varies, oHdr){
            if(group_varies){
                return `<span style="background-color: #CD5C5C;">${this.renderValue()}</span>`
            }
            return this.renderValue()
        }
        /** render value not in group */
        renderValue(val, val_prefix, val_suffix) {
            val = (val === undefined) ? this.val : val
            val_prefix = (val_prefix === undefined) ? this.val_prefix : val_prefix
            val_suffix = (val_suffix === undefined) ? this.val_suffix : val_suffix

            let ret = [val=== undefined?'':val];
            if (this.sig !== undefined && this.val_used == 1) { // negative not relevant
                ret.unshift('<match>');
                ret.push('</match>');
            }
            if (ret[0].length>0 && this.val_used == 1) {
                ret.unshift('<mark>');
                ret.push('</mark>');
            }
            if(val_prefix != undefined){ 
                ret.unshift(val_prefix)
            }
            if(val_suffix != undefined){ 
                ret.push(val_suffix)
            }

            return ret.join("");
        };

    }
    HttpHdr.prototype.headers = [
        "Unknown",
        "Content-Length",       // HTTP_HID_CONTENT_LENGTH:                                                   
        "Connection",           // HTTP_HID_CONNECTION:                        
        "Host",                 // HTTP_HID_HOST:                      
        "User-Agent",           // HTTP_HID_USER_AGENT:                        
        "Content-Type",         // HTTP_HID_CONTENT_TYPE:                      
        "Transfer-Encoding",    // HTTP_HID_TRANSFER_ENCODING:                         
        "Proxy-Connection",     // HTTP_HID_PROXY_CONNECTION:                      
        "Date",                 // HTTP_HID_DATE:                      
        "Last-Modified",        // HTTP_HID_LAST_MODIFIED:                         
        "ETag",                 // HTTP_HID_ETAG:                      
        "Cookie",               // HTTP_HID_COOKIE:                        
        "Set-Cookie",           // HTTP_HID_SET_COOKIE:                        
        "If-Modified-Since",    // HTTP_HID_IF_MODIFIED_SINCE:                         
        "Cache-Control",        // HTTP_HID_CACHE_CONTROL:                         
        "Set-Cookie2",          // HTTP_HID_SET_COOKIE2:                       
        "Accept",               // HTTP_HID_ACCEPT:                        
        "Pragma",               // HTTP_HID_PRAGMA:                        
        "Accept-Encoding",      // HTTP_HID_ACCEPT_ENCODING:                       
        "Content-Encoding",     // HTTP_HID_CONTENT_ENCODING:                      
        "Authorization",        // HTTP_HID_AUTHORIZATION:                         
        "Proxy-Authorization",  // HTTP_HID_PROXY_AUTHORIZATION:                       
        "Location",             // HTTP_HID_LOCATION:                      
        "Vary",                 // HTTP_HID_VARY:                      
        "Via",                  // HTTP_HID_VIA:                       
        "Range",                // HTTP_HID_RANGE:                         
        "If-Range",             // HTTP_HID_IF_RANGE:                      
        "If-Match",             // HTTP_HID_IF_MATCH:                      
        "If-None-Match",        // HTTP_HID_IF_NONE_MATCH:                         
        "If-Unmodified-Since",  // HTTP_HID_IF_UNMODIFIED_SINCE:                       
        "Expires",              // HTTP_HID_EXPIRES:                       
        "Age",                  // HTTP_HID_AGE:                       
        "X-Cnection",           // HTTP_HID_X_CNECTION:                        
        "WWW-Authenticate",     // HTTP_HID_WWW_AUTHENTICATE:                      
        "Proxy-Authenticate",   // HTTP_HID_PROXY_AUTHENTICATE:                        
        "Expect",               // HTTP_HID_EXPECT:                        
        "Referer",              // HTTP_HID_REFERER:                       
        "session-key",          // HTTP_HID_SESSION_KEY:                       
        "X-Forwarded-For"       // HTTP_HID_X_FORWARDED_FOR:                       
    ];
    /** @param header - header name 
     * @return index of header in HttpHdr.prototype.headers array, or undefined
    */
    HttpHdr.prototype.header2ix = (function() {
       let ret = {}
       HttpHdr.prototype.headers.forEach((h,i)=>{ret[h]=i})
       return function(header){return ret[header]}; 
    })();

    /** parse & render tls message version */
    class HttpMethod extends HttpHdr {
        constructor(val,sig){
            super('',val,sig)
        }
        renderValue() {
            return super.renderValue(HttpMethod.prototype.http_methods[this.val])
        }
    };
    HttpMethod.prototype.http_methods = [
        "UNKNOWN",
        "CONNECT",
        "DELETE",
        "GET",
        "HEAD",
        "LOCK",
        "OPTIONS",
        "POST",
        "PROPFIND",
        "PUT",
        "TRACE",
        "UNLOCK"
      ];

    /** stores one tls header value and if its used in signature, can render it (inherit for each specific header) */
    class TlsHdr {
        constructor(val, sig) {
            this.val = val
            this.sig = sig;
        }
        renderName() { return "" }
        /** render stored value or supplied val if given */
        renderValue(val) {
            val = (val === undefined) ? this.val : val
            var ret = [val];
            if (val.length > 0) {
                ret.unshift('<mark>');
                ret.push('</mark>');
            }
            if (this.sig != 0) {
                ret.unshift('<u>');
                ret.push('</u>');
            }
            return ret.join("");
        };
    };

    /** parse & render tls message version */
    class TlsMsg_version extends TlsHdr {
        constructor(tsl_sample_row){
            super(tsl_sample_row.int_value(1), tsl_sample_row.is_sig(6))
        }
        renderValue() {
            // https://en.wikipedia.org/wiki/Transport_Layer_Security Legacy Version
            let version = this.val;
            return super.renderValue((version in TlsMsg_version.prototype.MsgVer && TlsMsg_version.prototype.MsgVer[version]) || version)
        }
    };
    TlsMsg_version.prototype.MsgVer = {
        0x300: 'SSL 3.0',
        0x301: 'TLS 1.0',
        0x302: 'TLS 1.1',
        0x303: 'TLS 1.2',
        0x304: 'TLS 1.3'
    }

    class TlsCipher_suites extends TlsHdr {
        constructor(tsl_sample_row){
            super(tsl_sample_row.substr_payload(22,3,4), tsl_sample_row.is_sig(5))
        }
        renderName() {return 'cipher_suites'}
        renderValue() {
            // https://en.wikipedia.org/wiki/Transport_Layer_Security Legacy Version
            let ciphers = this.val
            let ret = _.chunk(ciphers, 2)
                .map(arr2 => ((arr2[0].charCodeAt(0) << 8) | arr2[1].charCodeAt(0)))
                .map(function (cid) {
                    if (cid in TlsCipher_suites.prototype.cipher_suites)
                        return TlsCipher_suites.prototype.cipher_suites[cid];
                    else return '0x' + cid;
                },
            )
                .map(v => ' ' + v + ', ')
                .join("")
            return super.renderValue(ret);
        }
    }
    TlsCipher_suites.prototype.cipher_suites = {
        0x0 : 'TLS_NULL_WITH_NULL_NULL',
        0x1 : 'TLS_RSA_WITH_NULL_MD5',
        0x2 : 'TLS_RSA_WITH_NULL_SHA',
        0x3 : 'TLS_RSA_EXPORT_WITH_RC4_40_MD5',
        0x4 : 'TLS_RSA_WITH_RC4_128_MD5',
        0x5 : 'TLS_RSA_WITH_RC4_128_SHA',
        0x6 : 'TLS_RSA_EXPORT_WITH_RC2_CBC_40_MD5',
        0x7 : 'TLS_RSA_WITH_IDEA_CBC_SHA',
        0x8 : 'TLS_RSA_EXPORT_WITH_DES40_CBC_SHA',
        0x9 : 'TLS_RSA_WITH_DES_CBC_SHA',
        0xa : 'TLS_RSA_WITH_3DES_EDE_CBC_SHA',
        0xb : 'TLS_DH_DSS_EXPORT_WITH_DES40_CBC_SHA',
        0xc : 'TLS_DH_DSS_WITH_DES_CBC_SHA',
        0xd : 'TLS_DH_DSS_WITH_3DES_EDE_CBC_SHA',
        0xe : 'TLS_DH_RSA_EXPORT_WITH_DES40_CBC_SHA',
        0xf : 'TLS_DH_RSA_WITH_DES_CBC_SHA',
        0x10 : 'TLS_DH_RSA_WITH_3DES_EDE_CBC_SHA',
        0x11 : 'TLS_DHE_DSS_EXPORT_WITH_DES40_CBC_SHA',
        0x12 : 'TLS_DHE_DSS_WITH_DES_CBC_SHA',
        0x13 : 'TLS_DHE_DSS_WITH_3DES_EDE_CBC_SHA',
        0x14 : 'TLS_DHE_RSA_EXPORT_WITH_DES40_CBC_SHA',
        0x15 : 'TLS_DHE_RSA_WITH_DES_CBC_SHA',
        0x16 : 'TLS_DHE_RSA_WITH_3DES_EDE_CBC_SHA',
        0x17 : 'TLS_DH_ANON_EXPORT_WITH_RC4_40_MD5',
        0x18 : 'TLS_DH_ANON_WITH_RC4_128_MD5',
        0x19 : 'TLS_DH_ANON_EXPORT_WITH_DES40_CBC_SHA',
        0x1a : 'TLS_DH_ANON_WITH_DES_CBC_SHA',
        0x1b : 'TLS_DH_ANON_WITH_3DES_EDE_CBC_SHA',
        0x1c : 'SSL_FORTEZZA_DMS_WITH_NULL_SHA',
        0x1d : 'SSL_FORTEZZA_DMS_WITH_FORTEZZA_CBC_SHA',
        0x1e : 'SSL_FORTEZZA_DMS_WITH_RC4_128_SHA',
        0x1f : 'TLS_KRB5_WITH_3DES_EDE_CBC_SHA',
        0x20 : 'TLS_KRB5_WITH_RC4_128_SHA',
        0x21 : 'TLS_KRB5_WITH_IDEA_CBC_SHA',
        0x22 : 'TLS_KRB5_WITH_DES_CBC_MD5',
        0x23 : 'TLS_KRB5_WITH_3DES_EDE_CBC_MD5',
        0x24 : 'TLS_KRB5_WITH_RC4_128_MD5',
        0x25 : 'TLS_KRB5_WITH_IDEA_CBC_MD5',
        0x26 : 'TLS_KRB5_EXPORT_WITH_DES_CBC_40_SHA',
        0x27 : 'TLS_KRB5_EXPORT_WITH_RC2_CBC_40_SHA',
        0x28 : 'TLS_KRB5_EXPORT_WITH_RC4_40_SHA',
        0x29 : 'TLS_KRB5_EXPORT_WITH_DES_CBC_40_MD5',
        0x2a : 'TLS_KRB5_EXPORT_WITH_RC2_CBC_40_MD5',
        0x2b : 'TLS_KRB5_EXPORT_WITH_RC4_40_MD5',
        0x2c : 'TLS_PSK_WITH_NULL_SHA',
        0x2d : 'TLS_DHE_PSK_WITH_NULL_SHA',
        0x2e : 'TLS_RSA_PSK_WITH_NULL_SHA',
        0x2f : 'TLS_RSA_WITH_AES_128_CBC_SHA',
        0x30 : 'TLS_DH_DSS_WITH_AES_128_CBC_SHA',
        0x31 : 'TLS_DH_RSA_WITH_AES_128_CBC_SHA',
        0x32 : 'TLS_DHE_DSS_WITH_AES_128_CBC_SHA',
        0x33 : 'TLS_DHE_RSA_WITH_AES_128_CBC_SHA',
        0x34 : 'TLS_DH_ANON_WITH_AES_128_CBC_SHA',
        0x35 : 'TLS_RSA_WITH_AES_256_CBC_SHA',
        0x36 : 'TLS_DH_DSS_WITH_AES_256_CBC_SHA',
        0x37 : 'TLS_DH_RSA_WITH_AES_256_CBC_SHA',
        0x38 : 'TLS_DHE_DSS_WITH_AES_256_CBC_SHA',
        0x39 : 'TLS_DHE_RSA_WITH_AES_256_CBC_SHA',
        0x3a : 'TLS_DH_ANON_WITH_AES_256_CBC_SHA',
        0x3b : 'TLS_RSA_WITH_NULL_SHA256',
        0x3c : 'TLS_RSA_WITH_AES_128_CBC_SHA256',
        0x3d : 'TLS_RSA_WITH_AES_256_CBC_SHA256',
        0x3e : 'TLS_DH_DSS_WITH_AES_128_CBC_SHA256',
        0x3f : 'TLS_DH_RSA_WITH_AES_128_CBC_SHA256',
        0x40 : 'TLS_DHE_DSS_WITH_AES_128_CBC_SHA256',
        0x41 : 'TLS_RSA_WITH_CAMELLIA_128_CBC_SHA',
        0x42 : 'TLS_DH_DSS_WITH_CAMELLIA_128_CBC_SHA',
        0x43 : 'TLS_DH_RSA_WITH_CAMELLIA_128_CBC_SHA',
        0x44 : 'TLS_DHE_DSS_WITH_CAMELLIA_128_CBC_SHA',
        0x45 : 'TLS_DHE_RSA_WITH_CAMELLIA_128_CBC_SHA',
        0x46 : 'TLS_DH_ANON_WITH_CAMELLIA_128_CBC_SHA',
        0x47 : 'TLS_ECDH_ECDSA_WITH_NULL_SHA',
        0x48 : 'TLS_ECDH_ECDSA_WITH_RC4_128_SHA',
        0x49 : 'TLS_ECDH_ECDSA_WITH_DES_CBC_SHA',
        0x4a : 'TLS_ECDH_ECDSA_WITH_3DES_EDE_CBC_SHA',
        0x4b : 'TLS_ECDH_ECDSA_WITH_AES_128_CBC_SHA',
        0x4c : 'TLS_ECDH_ECDSA_WITH_AES_256_CBC_SHA',
        0x60 : 'TLS_RSA_EXPORT1024_WITH_RC4_56_MD5',
        0x61 : 'TLS_RSA_EXPORT1024_WITH_RC2_CBC_56_MD5',
        0x62 : 'TLS_RSA_EXPORT1024_WITH_DES_CBC_SHA',
        0x63 : 'TLS_DHE_DSS_EXPORT1024_WITH_DES_CBC_SHA',
        0x64 : 'TLS_RSA_EXPORT1024_WITH_RC4_56_SHA',
        0x65 : 'TLS_DHE_DSS_EXPORT1024_WITH_RC4_56_SHA',
        0x66 : 'TLS_DHE_DSS_WITH_RC4_128_SHA',
        0x67 : 'TLS_DHE_RSA_WITH_AES_128_CBC_SHA256',
        0x68 : 'TLS_DH_DSS_WITH_AES_256_CBC_SHA256',
        0x69 : 'TLS_DH_RSA_WITH_AES_256_CBC_SHA256',
        0x6a : 'TLS_DHE_DSS_WITH_AES_256_CBC_SHA256',
        0x6b : 'TLS_DHE_RSA_WITH_AES_256_CBC_SHA256',
        0x6c : 'TLS_DH_ANON_WITH_AES_128_CBC_SHA256',
        0x6d : 'TLS_DH_ANON_WITH_AES_256_CBC_SHA256',
        0x80 : 'TLS_GOSTR341094_WITH_28147_CNT_IMIT',
        0x81 : 'TLS_GOSTR341001_WITH_28147_CNT_IMIT',
        0x82 : 'TLS_GOSTR341094_WITH_NULL_GOSTR3411',
        0x83 : 'TLS_GOSTR341001_WITH_NULL_GOSTR3411',
        0x84 : 'TLS_RSA_WITH_CAMELLIA_256_CBC_SHA',
        0x85 : 'TLS_DH_DSS_WITH_CAMELLIA_256_CBC_SHA',
        0x86 : 'TLS_DH_RSA_WITH_CAMELLIA_256_CBC_SHA',
        0x87 : 'TLS_DHE_DSS_WITH_CAMELLIA_256_CBC_SHA',
        0x88 : 'TLS_DHE_RSA_WITH_CAMELLIA_256_CBC_SHA',
        0x89 : 'TLS_DH_ANON_WITH_CAMELLIA_256_CBC_SHA',
        0x8a : 'TLS_PSK_WITH_RC4_128_SHA',
        0x8b : 'TLS_PSK_WITH_3DES_EDE_CBC_SHA',
        0x8c : 'TLS_PSK_WITH_AES_128_CBC_SHA',
        0x8d : 'TLS_PSK_WITH_AES_256_CBC_SHA',
        0x8e : 'TLS_DHE_PSK_WITH_RC4_128_SHA',
        0x8f : 'TLS_DHE_PSK_WITH_3DES_EDE_CBC_SHA',
        0x90 : 'TLS_DHE_PSK_WITH_AES_128_CBC_SHA',
        0x91 : 'TLS_DHE_PSK_WITH_AES_256_CBC_SHA',
        0x92 : 'TLS_RSA_PSK_WITH_RC4_128_SHA',
        0x93 : 'TLS_RSA_PSK_WITH_3DES_EDE_CBC_SHA',
        0x94 : 'TLS_RSA_PSK_WITH_AES_128_CBC_SHA',
        0x95 : 'TLS_RSA_PSK_WITH_AES_256_CBC_SHA',
        0x96 : 'TLS_RSA_WITH_SEED_CBC_SHA',
        0x97 : 'TLS_DH_DSS_WITH_SEED_CBC_SHA',
        0x98 : 'TLS_DH_RSA_WITH_SEED_CBC_SHA',
        0x99 : 'TLS_DHE_DSS_WITH_SEED_CBC_SHA',
        0x9a : 'TLS_DHE_RSA_WITH_SEED_CBC_SHA',
        0x9b : 'TLS_DH_ANON_WITH_SEED_CBC_SHA',
        0x9c : 'TLS_RSA_WITH_AES_128_GCM_SHA256',
        0x9d : 'TLS_RSA_WITH_AES_256_GCM_SHA384',
        0x9e : 'TLS_DHE_RSA_WITH_AES_128_GCM_SHA256',
        0x9f : 'TLS_DHE_RSA_WITH_AES_256_GCM_SHA384',
        0xa0 : 'TLS_DH_RSA_WITH_AES_128_GCM_SHA256',
        0xa1 : 'TLS_DH_RSA_WITH_AES_256_GCM_SHA384',
        0xa2 : 'TLS_DHE_DSS_WITH_AES_128_GCM_SHA256',
        0xa3 : 'TLS_DHE_DSS_WITH_AES_256_GCM_SHA384',
        0xa4 : 'TLS_DH_DSS_WITH_AES_128_GCM_SHA256',
        0xa5 : 'TLS_DH_DSS_WITH_AES_256_GCM_SHA384',
        0xa6 : 'TLS_DH_ANON_WITH_AES_128_GCM_SHA256',
        0xa7 : 'TLS_DH_ANON_WITH_AES_256_GCM_SHA384',
        0xa8 : 'TLS_PSK_WITH_AES_128_GCM_SHA256',
        0xa9 : 'TLS_PSK_WITH_AES_256_GCM_SHA384',
        0xaa : 'TLS_DHE_PSK_WITH_AES_128_GCM_SHA256',
        0xab : 'TLS_DHE_PSK_WITH_AES_256_GCM_SHA384',
        0xac : 'TLS_RSA_PSK_WITH_AES_128_GCM_SHA256',
        0xad : 'TLS_RSA_PSK_WITH_AES_256_GCM_SHA384',
        0xae : 'TLS_PSK_WITH_AES_128_CBC_SHA256',
        0xaf : 'TLS_PSK_WITH_AES_256_CBC_SHA384',
        0xb0 : 'TLS_PSK_WITH_NULL_SHA256',
        0xb1 : 'TLS_PSK_WITH_NULL_SHA384',
        0xb2 : 'TLS_DHE_PSK_WITH_AES_128_CBC_SHA256',
        0xb3 : 'TLS_DHE_PSK_WITH_AES_256_CBC_SHA384',
        0xb4 : 'TLS_DHE_PSK_WITH_NULL_SHA256',
        0xb5 : 'TLS_DHE_PSK_WITH_NULL_SHA384',
        0xb6 : 'TLS_RSA_PSK_WITH_AES_128_CBC_SHA256',
        0xb7 : 'TLS_RSA_PSK_WITH_AES_256_CBC_SHA384',
        0xb8 : 'TLS_RSA_PSK_WITH_NULL_SHA256',
        0xb9 : 'TLS_RSA_PSK_WITH_NULL_SHA384',
        0xff : 'TLS_EMPTY_RENEGOTIATION_INFO_SCSV',
        0xc001 : 'TLS_ECDH_ECDSA_WITH_NULL_SHA',
        0xc002 : 'TLS_ECDH_ECDSA_WITH_RC4_128_SHA',
        0xc003 : 'TLS_ECDH_ECDSA_WITH_3DES_EDE_CBC_SHA',
        0xc004 : 'TLS_ECDH_ECDSA_WITH_AES_128_CBC_SHA',
        0xc005 : 'TLS_ECDH_ECDSA_WITH_AES_256_CBC_SHA',
        0xc006 : 'TLS_ECDHE_ECDSA_WITH_NULL_SHA',
        0xc007 : 'TLS_ECDHE_ECDSA_WITH_RC4_128_SHA',
        0xc008 : 'TLS_ECDHE_ECDSA_WITH_3DES_EDE_CBC_SHA',
        0xc009 : 'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA',
        0xc00a : 'TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA',
        0xc00b : 'TLS_ECDH_RSA_WITH_NULL_SHA',
        0xc00c : 'TLS_ECDH_RSA_WITH_RC4_128_SHA',
        0xc00d : 'TLS_ECDH_RSA_WITH_3DES_EDE_CBC_SHA',
        0xc00e : 'TLS_ECDH_RSA_WITH_AES_128_CBC_SHA',
        0xc00f : 'TLS_ECDH_RSA_WITH_AES_256_CBC_SHA',
        0xc010 : 'TLS_ECDHE_RSA_WITH_NULL_SHA',
        0xc011 : 'TLS_ECDHE_RSA_WITH_RC4_128_SHA',
        0xc012 : 'TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA',
        0xc013 : 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
        0xc014 : 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
        0xc015 : 'TLS_ECDH_ANON_WITH_NULL_SHA',
        0xc016 : 'TLS_ECDH_ANON_WITH_RC4_128_SHA',
        0xc017 : 'TLS_ECDH_ANON_WITH_3DES_EDE_CBC_SHA',
        0xc018 : 'TLS_ECDH_ANON_WITH_AES_128_CBC_SHA',
        0xc019 : 'TLS_ECDH_ANON_WITH_AES_256_CBC_SHA',
        0xc01a : 'TLS_SRP_SHA_WITH_3DES_EDE_CBC_SHA',
        0xc01b : 'TLS_SRP_SHA_RSA_WITH_3DES_EDE_CBC_SHA',
        0xc01c : 'TLS_SRP_SHA_DSS_WITH_3DES_EDE_CBC_SHA',
        0xc01d : 'TLS_SRP_SHA_WITH_AES_128_CBC_SHA',
        0xc01e : 'TLS_SRP_SHA_RSA_WITH_AES_128_CBC_SHA',
        0xc01f : 'TLS_SRP_SHA_DSS_WITH_AES_128_CBC_SHA',
        0xc020 : 'TLS_SRP_SHA_WITH_AES_256_CBC_SHA',
        0xc021 : 'TLS_SRP_SHA_RSA_WITH_AES_256_CBC_SHA',
        0xc022 : 'TLS_SRP_SHA_DSS_WITH_AES_256_CBC_SHA',
        0xc023 : 'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256',
        0xc024 : 'TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA384',
        0xc025 : 'TLS_ECDH_ECDSA_WITH_AES_128_CBC_SHA256',
        0xc026 : 'TLS_ECDH_ECDSA_WITH_AES_256_CBC_SHA384',
        0xc027 : 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256',
        0xc028 : 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384',
        0xc029 : 'TLS_ECDH_RSA_WITH_AES_128_CBC_SHA256',
        0xc02a : 'TLS_ECDH_RSA_WITH_AES_256_CBC_SHA384',
        0xc02b : 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
        0xc02c : 'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
        0xc02d : 'TLS_ECDH_ECDSA_WITH_AES_128_GCM_SHA256',
        0xc02e : 'TLS_ECDH_ECDSA_WITH_AES_256_GCM_SHA384',
        0xc02f : 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
        0xc030 : 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
        0xc031 : 'TLS_ECDH_RSA_WITH_AES_128_GCM_SHA256',
        0xc032 : 'TLS_ECDH_RSA_WITH_AES_256_GCM_SHA384',
        0xc033 : 'TLS_ECDHE_PSK_WITH_RC4_128_SHA',
        0xc034 : 'TLS_ECDHE_PSK_WITH_3DES_EDE_CBC_SHA',
        0xc035 : 'TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA',
        0xc036 : 'TLS_ECDHE_PSK_WITH_AES_256_CBC_SHA',
        0xc037 : 'TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA256',
        0xc038 : 'TLS_ECDHE_PSK_WITH_AES_256_CBC_SHA384',
        0xc039 : 'TLS_ECDHE_PSK_WITH_NULL_SHA',
        0xc03a : 'TLS_ECDHE_PSK_WITH_NULL_SHA256',
        0xc03b : 'TLS_ECDHE_PSK_WITH_NULL_SHA384',
        0xfefe : 'SSL_RSA_FIPS_WITH_DES_CBC_SHA',
        0xfeff : 'SSL_RSA_FIPS_WITH_3DES_EDE_CBC_SHA',
        0xff01 : 'SSL_EN_RC4_128_WITH_MD5',
        0xff02 : 'SSL_EN_RC4_128_EXPORT40_WITH_MD5',
        0xff03 : 'SSL_EN_RC2_128_CBC_WITH_MD5',
        0xff04 : 'SSL_EN_RC2_128_CBC_EXPORT40_WITH_MD5',
        0xff05 : 'SSL_EN_IDEA_128_CBC_WITH_MD5',
        0xff06 : 'SSL_EN_DES_64_CBC_WITH_MD5',
        0xff07 : 'SSL_EN_DES_192_EDE3_CBC_WITH_MD5',
        0xffe0 : 'SSL_RSA_OLDFIPS_WITH_3DES_EDE_CBC_SHA',
        0xffe1 : 'SSL_RSA_OLDFIPS_WITH_DES_CBC_SHA'
      }
    //end TlsCipher_suites
    
    class TlsServer_name extends TlsHdr {
        constructor(tsl_sample_row){
            super(tsl_sample_row.substr_payload(22,6,7), tsl_sample_row.is_sig(4))
        }
        renderName() {return 'server_name'}
    }

    class TlsEc_point extends TlsHdr {
        constructor(tsl_sample_row){
            super(tsl_sample_row.substr_payload(22,9,10), tsl_sample_row.is_sig(3))
        }
        renderName() {return 'ec_point'}
        renderValue() {
            let ec_points = this.val
            if (ec_points.length > 0) {
                if (ec_points.charCodeAt(0) + 1 == ec_points.length) {
                    return super.renderValue(ec_points.slice(1).split('').map(
                        function (c) {
                            var v = c.charCodeAt(0);
                            if (v in TlsEc_point.prototype.ECPointFormat)
                                return TlsEc_point.prototype.ECPointFormat[v]
                            return v
                        }).join(","))
                }
            }
            return super.renderValue('')
        }
    }
    TlsEc_point.prototype.ECPointFormat = {0:'uncompressed',1:'ansiX962_compressed_prime',2:'ansiX962_compressed_char2'} // https://tools.ietf.org/html/rfc4492#page-13 5.1.2

    class TlsElliptic_curves extends TlsHdr {
        constructor(tsl_sample_row){
            super(tsl_sample_row.substr_payload(22,12,13), tsl_sample_row.is_sig(2))
        }
        renderName() {return 'elliptic_curves'}
        renderValue() {
            let elc = this.val
            return super.renderValue(_.chunk(elc,2).map(function(c){
                let v=(c[0].charCodeAt(0)<<8) | c[1].charCodeAt(0); 
                return (v in TlsElliptic_curves.prototype.NamedCurve && TlsElliptic_curves.prototype.NamedCurve[v]) || v;}).join(","))
        }
    }
    TlsElliptic_curves.prototype.NamedCurve = Utils.RFCEnum2Dict(`sect163k1 (1), sect163r1 (2), sect163r2 (3),
        sect193r1 (4), sect193r2 (5), sect233k1 (6),
        sect233r1 (7), sect239k1 (8), sect283k1 (9),
        sect283r1 (10), sect409k1 (11), sect409r1 (12),
        sect571k1 (13), sect571r1 (14), secp160k1 (15),
        secp160r1 (16), secp160r2 (17), secp192k1 (18),
        secp192r1 (19), secp224k1 (20), secp224r1 (21),
        secp256k1 (22), secp256r1 (23), secp384r1 (24),
        secp521r1 (25),
        arbitrary_explicit_prime_curves(0xFF01),
        arbitrary_explicit_char2_curves(0xFF02)`);

    class TlsExt_signature extends TlsHdr {
        constructor(tsl_sample_row, protocol_version){
            super(tsl_sample_row.substr_payload(22,15,16), tsl_sample_row.is_sig(1))
            this.protocol_version = protocol_version
        }
        renderName() {return 'ext_signature'}
        renderValue() {
           //protocol_version = ? tls 1.3 (single values) https://tools.ietf.org/html/draft-ietf-tls-tls13-16#page-35 4.2.3
            //protocol_version = 0x303 tls 1.2 (pair values) https://tools.ietf.org/html/rfc5246#section-7.4.1.4.1 7.4.1.4.1. 
            let sig = this.val
            if (this.protocol_version == 0x304) {
                sig = _.chunk(sig, 2).map(function (c) {
                    let v = (c[0].charCodeAt(0) << 8) | c[1].charCodeAt(0);
                    return (v in TlsExt_signature.prototype.SignatureScheme && TlsExt_signature.prototype.SignatureScheme[v]) || v;
                }).join(",")
            } else {
                sig = _.chunk(sig, 2).map(function (c) {
                    let h = c[0].charCodeAt(0)
                    let s = c[1].charCodeAt(0);
                    return ((h in TlsExt_signature.prototype.HashAlgorithm && TlsExt_signature.prototype.HashAlgorithm[h]) || h) + '+' + ((s in TlsExt_signature.prototype.SignatureAlgorithm && TlsExt_signature.prototype.SignatureAlgorithm[s]) || s);
                }).join(", ")
            }
            return super.renderValue(sig)
        }
    }
    TlsExt_signature.prototype.SignatureScheme = Utils.RFCEnum2Dict(`rsa_pkcs1_sha1 (0x0201),
        rsa_pkcs1_sha256 (0x0401),
        rsa_pkcs1_sha384 (0x0501),
        rsa_pkcs1_sha512 (0x0601),
        ecdsa_secp256r1_sha256 (0x0403),
        ecdsa_secp384r1_sha384 (0x0503),
        ecdsa_secp521r1_sha512 (0x0603),
        rsa_pss_sha256 (0x0804),
        rsa_pss_sha384 (0x0805),
        rsa_pss_sha512 (0x0806),
        ed25519 (0x0807),
        ed448 (0x0808)`);
    TlsExt_signature.prototype.HashAlgorithm = Utils.RFCEnum2Dict(`none(0), md5(1), sha1(2), sha224(3), sha256(4), sha384(5), sha512(6)`);
    TlsExt_signature.prototype.SignatureAlgorithm = Utils.RFCEnum2Dict(`anonymous(0), rsa(1), dsa(2), ecdsa(3)`);

    class TlsApp_layer extends TlsHdr {
        constructor(tsl_sample_row, protocol_version){
            super(tsl_sample_row.substr_payload(22,18,19), tsl_sample_row.is_sig(0))
        }
        renderName() {return 'app_layer'}
        renderValue(){
            let elc = this.val
            if (elc.length >= 2) {
                var arr_len = elc.charCodeAt(0) << 8 | elc.charCodeAt(1);
                if (elc.length - 2 == arr_len) {
                    var ret = []
                    for (var i = 2; i < elc.length; i++) {
                        var len = elc.charCodeAt(i)
                        ret.push(elc.substr(i + 1, len))
                        i += len
                    }
                    return super.renderValue(ret.join(','))
                }
            }
            return super.renderValue('')
        }
    }

    return TrainArray;
})
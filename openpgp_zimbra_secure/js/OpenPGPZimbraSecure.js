/*
 * ***** BEGIN LICENSE BLOCK *****
 * OpenPGP Zimbra Secure is the open source digital signature and encrypt for Zimbra Collaboration Open Source Edition software
 * Copyright (C) 2016-present OpenPGP Zimbra Secure

 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.

 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>
 * ***** END LICENSE BLOCK *****
 *
 * OpenPGP MIME Secure Email Zimlet
 *
 * Written by nguyennv1981@gmail.com
 */

function openpgp_zimbra_secure_HandlerObject() {
    this._msgDivCache = {};
    this._pgpMessageCache = appCtxt.isChildWindow ? window.opener.openpgp_zimbra_secure_HandlerObject.getInstance()._pgpMessageCache : {};
    this._sendingAttachments = [];
    this._pgpAttachments = {};
    this._keyStore = new OpenPGPSecureKeyStore(this);
    this._securePassword = '';
    var pwdKey = 'openpgp_secure_password_' + this.getUserID();
    if (localStorage[pwdKey]) {
        this._securePassword = localStorage[pwdKey];
    }
    else {
        localStorage[pwdKey] = this._securePassword = OpenPGPUtils.randomString({
            length: 24
        });
    }
};

openpgp_zimbra_secure_HandlerObject.prototype = new ZmZimletBase();
openpgp_zimbra_secure_HandlerObject.prototype.constructor = openpgp_zimbra_secure_HandlerObject;

openpgp_zimbra_secure_HandlerObject.prototype.toString = function() {
    return 'openpgp_zimbra_secure_HandlerObject';
};

var OpenPGPZimbraSecure = openpgp_zimbra_secure_HandlerObject;

OpenPGPZimbraSecure.BUTTON_CLASS = 'openpgp_zimbra_secure_button';
OpenPGPZimbraSecure.PREF_SECURITY = 'OPENPGP_SECURITY';
OpenPGPZimbraSecure.USER_SECURITY = 'OPENPGP_USER_SECURITY';

OpenPGPZimbraSecure.OPENPGP_AUTO = 'openpgp_auto';
OpenPGPZimbraSecure.OPENPGP_DONTSIGN = 'openpgp_dontsign';
OpenPGPZimbraSecure.OPENPGP_SIGN = 'openpgp_sign';
OpenPGPZimbraSecure.OPENPGP_SIGNENCRYPT = 'openpgp_signencrypt';

OpenPGPZimbraSecure.prototype.init = function() {
    var self = this;

    if (appCtxt.isChildWindow) {
        this._handleNewWindow();
    }

    AjxDispatcher.addPackageLoadFunction('MailCore', new AjxCallback(this, function(){
        self._overrideZmMailMsg();

        var responseLoadMsgsFunc = ZmConv.prototype._handleResponseLoadMsgs;
        ZmConv.prototype._handleResponseLoadMsgs = function(callback, result) {
            var newCallback = new AjxCallback(this, function(newResult) {
                responseLoadMsgsFunc.call(this, callback, newResult || result);
            });
            self._handleMessageResponse(newCallback, result);
        };
        self._overrideZmMailMsgView();
    }));

    AjxDispatcher.addPackageLoadFunction('Startup1_2', new AjxCallback(this, function() {
        self._overrideZmSearch();
    }));

    AjxDispatcher.addPackageLoadFunction('NewWindow_2', new AjxCallback(this, function() {
        self._handleNewWindow();
    }));

    this._addJsScripts([
        this.getResource('js/openpgpjs/openpgp.min.js'),
        this.getResource('js/mimemessage/mimemessage.js')
    ], new AjxCallback(function() {
        self._initOpenPGP();
    }));

    if (appCtxt.get(ZmSetting.MAIL_ENABLED)) {
        AjxPackage.require({
            name: 'MailCore',
            callback: new AjxCallback(this, this.addAttachmentHandler)
        });
    }
};

OpenPGPZimbraSecure.prototype._handleNewWindow = function() {
    this._overrideZmMailMsg();
    this._overrideZmSearch();
    this._overrideZmMailMsgView();
}

OpenPGPZimbraSecure.prototype._overrideZmMailMsg = function() {
    var self = this;
    var sendMsgFunc = ZmMailMsg.prototype._sendMessage;
    ZmMailMsg.prototype._sendMessage = function(params) {
        self._sendMessage(sendMsgFunc, this, params);
    }

    var fetchMsgFunc = ZmMailMsg._handleResponseFetchMsg;
    ZmMailMsg._handleResponseFetchMsg = function(callback, result) {
        var newCallback = new AjxCallback(this, function(newResult) {
            fetchMsgFunc.call(this, callback, newResult || result);
        });
        self._handleMessageResponse(newCallback, result);
    };
}

OpenPGPZimbraSecure.prototype._overrideZmSearch = function() {
    var self = this;
    var responseGetConvFunc = ZmSearch.prototype._handleResponseGetConv;
    ZmSearch.prototype._handleResponseGetConv = function(callback, result) {
        var newCallback = new AjxCallback(this, function(newResult) {
            responseGetConvFunc.call(this, callback, newResult || result);
        });
        self._handleMessageResponse(newCallback, result);
    };

    var responseExecuteFunc = ZmSearch.prototype._handleResponseExecute;
    ZmSearch.prototype._handleResponseExecute = function(callback, result) {
        var newCallback = new AjxCallback(this, function(newResult) {
            responseExecuteFunc.call(this, callback, newResult || result);
        });
        self._handleMessageResponse(newCallback, result);
    };
}

OpenPGPZimbraSecure.prototype._overrideZmMailMsgView = function() {
    var self = this;
    var inlineImgFunc = ZmMailMsgView.__unfangInternalImage;
    ZmMailMsgView.__unfangInternalImage = function(msg, elem, aname, external) {
        var result = inlineImgFunc(msg, elem, aname, external);
        if (aname == 'src' && self._pgpMessageCache[msg.id]) {
            var pgpMessage = self._pgpMessageCache[msg.id];
            if (pgpMessage.encrypted) {
                var pnSrc = Dwt.getAttr(elem, 'pn' + aname);
                var link = pnSrc || Dwt.getAttr(elem, aname);

                if (link && link.substring(0, 4) === 'cid:') {
                    OpenPGPUtils.visitMessage(pgpMessage, function(message) {
                        var cd = message.header('Content-Disposition');
                        var cid = message.header('Content-ID');
                        if (cid) {
                            cid = cid.replace(/[<>]/g, '');
                        }
                        if (cd === 'attachment' && cid === link.substring(4) && typeof message._body === 'string') {
                            var ct = message.contentType();
                            var newLink = 'data:' + ct.fulltype + ';base64,' + message._body.replace(/\r?\n/g, '');
                            elem.setAttribute('src', newLink);
                        }
                    });
                }
            }
        }
        return result;
    };
}

OpenPGPZimbraSecure.prototype.addAttachmentHandler = function() {
    var self = this;

    OpenPGPUtils.OPENPGP_CONTENT_TYPES.forEach(function(contentType) {
        ZmMimeTable._table[contentType] = {
            desc: 'OpenPGP encrypted file',
            image: 'PGPEncrypted',
            imageLarge: 'PGPEncrypted'
        };
    });

    var app = appCtxt.getAppController().getApp(ZmId.APP_MAIL);
    var controller = app.getMsgController(app.getCurrentSessionId(ZmId.VIEW_MSG));
    var viewType = appCtxt.getViewTypeFromId(ZmMsgController.getDefaultViewType());
    controller._initializeView(viewType);
    var view = controller._view[viewType];

    for (var mimeType in ZmMimeTable._table) {
        if (mimeType === 'application/pgp-encrypted') {
            view.addAttachmentLinkHandler(mimeType, 'OpenPGPZimbraSecure', function(attachment) {
                var title = self.getMessage('decryptFile');
                var linkId = view._getAttachmentLinkId(attachment.part, 'decrypt');
                var linkAttrs = [
                    'href="javascript:;"',
                    'onclick="OpenPGPZimbraSecure.decryptAttachment(\'' + attachment.label + '\', \'' + attachment.url + '\')"',
                    'class="AttLink"',
                    'style="text-decoration:underline;"',
                    'id="' + linkId + '"',
                    'title="' + title + '"'
                ];
                return '<a ' + linkAttrs.join(' ') + '>' + title + '</a>';
            });
        }
        else if (mimeType === 'application/pgp-keys') {
            view.addAttachmentLinkHandler(mimeType, 'OpenPGPZimbraSecure', function(attachment) {
                var title = self.getMessage('importPublicKey');
                var linkId = view._getAttachmentLinkId(attachment.part, 'import');
                var linkAttrs = [
                    'href="javascript:;"',
                    'onclick="OpenPGPZimbraSecure.importAttachmentKey(\'' + attachment.label + '\', \'' + attachment.url + '\')"',
                    'class="AttLink"',
                    'style="text-decoration:underline;"',
                    'id="' + linkId + '"',
                    'title="' + title + '"'
                ];
                return '<a ' + linkAttrs.join(' ') + '>' + title + '</a>';
            });
        }
    }
};

OpenPGPZimbraSecure.prototype.getKeyStore = function() {
    return this._keyStore;
};

OpenPGPZimbraSecure.prototype.getSecurePassword = function() {
    return this._securePassword;
};

/**
 * Additional processing of message from server before handling control back
 * to Zimbra.
 *
 * @param {AjxCallback} callback original callback
 * @param {ZmCsfeResult} csfeResult
 */
OpenPGPZimbraSecure.prototype._handleMessageResponse = function(callback, csfeResult) {
    var self = this;
    var encoded = false;
    if (csfeResult) {
        var response = csfeResult.getResponse();
    }
    else {
        response = { _jsns: 'urn:zimbraMail', more: false };
    }

    function hasPGPPart(part, msg) {
        var ct = part.ct;
        var hasPGP = false;

        if (OpenPGPUtils.isPGPKeysContentType(ct) && msg) {
            msg.hasPGPKey = true;
        }
        if (OpenPGPUtils.isPGPContentType(ct)) {
            hasPGP = true;
        }
        else if (!part.mp) {
            hasPGP = false;
        }
        else {
            if (ct != ZmMimeTable.MSG_RFC822) {
                for (var i = 0; i < part.mp.length; i++) {
                    if (hasPGPPart(part.mp[i], msg))
                        hasPGP = true;
                }
            }
        }

        return hasPGP;
    }

    function hasInlinePGP(part, msg) {
        if (part.content && OpenPGPUtils.hasInlinePGPContent(part.content)) {
            if (OpenPGPUtils.hasInlinePGPContent(part.content, OpenPGPUtils.OPENPGP_PUBLIC_KEY_HEADER)) {
                msg.hasPGPKey = true;
                msg.pgpKey = part.content;
            }
            return true;
        } else if (!part.mp) {
            return false;
        }
        else {
            for (var i = 0; i < part.mp.length; i++) {
                if (hasInlinePGP(part.mp[i], msg))
                    return true;
            }
        }
        return false
    }

    var pgpMsgs = [];
    var inlinePGPMsgs = [];
    var msgs = [];

    for (var name in response) {
        var m = response[name].m;
        if (!m && response[name].c) {
            m = response[name].c[0].m;
        }
        if (m) {
            for (var i = 0; i < m.length; i++) {
                if (m[i]) {
                    msgs.push(m[i]);
                }
            }
        }
    }

    msgs.forEach(function(msg) {
        msg.hasPGPKey = false;
        msg.pgpKey = false;
        if (hasInlinePGP(msg, msg)) {
            inlinePGPMsgs.push(msg);
        }
        else if (hasPGPPart(msg, msg)) {
            pgpMsgs.push(msg);
        }
    });

    if (pgpMsgs.length == 0 && inlinePGPMsgs.length == 0) {
        callback.run(csfeResult);
    }
    else {
        if (pgpMsgs.length > 0) {
            this._loadPGPMessages(callback, csfeResult, pgpMsgs);
        }
        if (inlinePGPMsgs.length > 0) {
            this._loadInlinePGPMessages(callback, csfeResult, inlinePGPMsgs);
        }
    }
};

/**
 * Load and decrypt the given inline pgp messages.
 * @param {AjxCallback} callback
 * @param {?} csfeResult
 * @param {Array} inlinePGPMsgs messages to load.
 */
OpenPGPZimbraSecure.prototype._loadInlinePGPMessages = function(callback, csfeResult, inlinePGPMsgs){
    var self = this;
    var handled = 0;
    var allLoadedCallback = new AjxCallback(function(){
        handled += 1;
        if (handled == inlinePGPMsgs.length) {
            callback.run(csfeResult);
        }
    });

    inlinePGPMsgs.forEach(function(msg) {
        var newCallback = new AjxCallback(self, self._decryptInlineMessage, [allLoadedCallback, msg]);
        var partId = msg.part ? '&part=' + msg.part : '';
        //add a timestamp param so that browser will not cache the request
        var timestamp = '&timestamp=' + new Date().getTime();

        var loadUrl = [
            appCtxt.get(ZmSetting.CSFE_MSG_FETCHER_URI), '&id=', msg.id, partId, timestamp
        ].join('');

        AjxRpc.invoke('', loadUrl, {
            'X-Zimbra-Encoding': 'x-base64'
        }, newCallback, true);
    });
};

OpenPGPZimbraSecure.prototype._decryptInlineMessage = function(callback, msg, response){
    var self = this;
    if (response.success) {
        var contentPart = false;
        OpenPGPUtils.visitMimePart(msg, function(mp) {
            if (mp.body && mp.content) {
                contentPart = mp;
            }
        });
        if (contentPart) {
            if (contentPart.ct.indexOf(ZmMimeTable.TEXT_HTML) >= 0) {
                var content = AjxStringUtil.stripTags(contentPart.content);
            }
            else {
                var content = contentPart.content;
            }
            OpenPGPDecrypt.decryptContent(
                content,
                self._keyStore.getPublicKeys(),
                self._keyStore.getPrivateKey(),
                function(result) {
                    if (result.content) {
                        if (contentPart.ct.indexOf(ZmMimeTable.TEXT_HTML) >= 0) {
                            contentPart.content = '<pre>' + result.content + '</pre>';
                        }
                        else {
                            contentPart.content = result.content;
                        }
                    }
                    var text = OpenPGPUtils.base64Decode(response.text);
                    var message = mimemessage.parse(text.replace(/\r?\n/g, '\r\n'));
                    message.signatures = result.signatures;
                    message.hasPGPKey = msg.hasPGPKey;
                    message.pgpKey = msg.pgpKey;
                    self._pgpMessageCache[msg.id] = message;
                    callback.run();
                }
            );
        }
        else {
            callback.run();
        }
    } else {
        console.warn('Failed to get message source:');
        console.warn(response);
        callback.run();
    }
};

/**
 * Load and decrypt the given pgp messages.
 * @param {AjxCallback} callback
 * @param {?} csfeResult
 * @param {Array} pgpMsgs messages to load.
 */
OpenPGPZimbraSecure.prototype._loadPGPMessages = function(callback, csfeResult, pgpMsgs){
    var self = this;
    var handled = 0;
    var allLoadedCallback = new AjxCallback(function(){
        handled += 1;
        if (handled == pgpMsgs.length) {
            callback.run(csfeResult);
        }
    });

    pgpMsgs.forEach(function(msg) {
        var newCallback = new AjxCallback(self, self._decryptMessage, [allLoadedCallback, msg]);
        var partId = msg.part ? '&part=' + msg.part : '';
        //add a timestamp param so that browser will not cache the request
        var timestamp = '&timestamp=' + new Date().getTime();

        var loadUrl = [
            appCtxt.get(ZmSetting.CSFE_MSG_FETCHER_URI), '&id=', msg.id, partId, timestamp
        ].join('');

        AjxRpc.invoke('', loadUrl, {
            'X-Zimbra-Encoding': 'x-base64'
        }, newCallback, true);
    });
};

/**
 * PGP Mime decrypt the given text.
 * @param {AjxCallback} callback
 * @param {ZmMailMsg} msg
 * @param {Object} response
 */
OpenPGPZimbraSecure.prototype._decryptMessage = function(callback, msg, response){
    var self = this;
    if (response.success) {
        var decryptor = new OpenPGPDecrypt({
            privateKey: this._keyStore.getPrivateKey(),
            publicKeys: this._keyStore.getPublicKeys(),
            onDecrypted: function(decryptor, message) {
                self.onDecrypted(callback, msg, message);
            },
            onError: function(decryptor, error) {
                console.log(error);
                self._onEncryptError('decrypting-error');
            }
        }, OpenPGPUtils.base64Decode(response.text));
        decryptor.decrypt();
    } else {
        console.warn('Failed to get message source:');
        console.warn(response);
        callback.run();
    }
};

/**
 * Process the decrypted message before parsing control back to Zimbra.
 * @param {AjxCallback} callback
 * @param {ZmMailMsg} msg
 * @param {Object} PGP mime message.
 */
OpenPGPZimbraSecure.prototype.onDecrypted = function(callback, msg, pgpMessage) {
    pgpMessage.hasPGPKey = msg.hasPGPKey;
    pgpMessage.pgpKey = msg.pgpKey;
    this._pgpMessageCache[msg.id] = pgpMessage;

    if (pgpMessage.encrypted) {
        var mp = OpenPGPUtils.mimeMessageToZmMimePart(pgpMessage);
        msg.mp = [mp];
    }

    callback.run();
};

/**
* Sends the given message
* @param {Function} orig original func ZmMailMsg.prototype._sendMessage
* @param {ZmMailMsg} msg
* @param {Object} params the mail params inluding the jsonObj msg.
*/
OpenPGPZimbraSecure.prototype._sendMessage = function(orig, msg, params) {
    var sender = new OpenPGPSecureSender(this, orig, msg, params);
    return sender.send();
};

/**
 * This method is called when a message is viewed in Zimbra.
 * This method is called by the Zimlet framework when a user clicks-on a message in the mail application.
 */
OpenPGPZimbraSecure.prototype.onMsgView = function(msg, oldMsg, msgView) {
    this._renderMessageInfo(msg, msgView);
};

OpenPGPZimbraSecure.prototype.onMsgExpansion = function(msg, msgView) {
    this._renderMessageInfo(msg, msgView);
};

OpenPGPZimbraSecure.prototype.onConvView = function(msg, oldMsg, convView) {
    this._renderMessageInfo(msg, convView);
};

OpenPGPZimbraSecure.prototype._renderMessageInfo = function(msg, view) {
    var self = this;
    if (!msg || !view._hdrTableId || msg.isDraft)
        return;
    var pgpMessage = this._pgpMessageCache[msg.id];
    if (!pgpMessage) {
        return;
    }

    pgpMessage.signatures.forEach(function(signature) {
        var userid = AjxStringUtil.htmlEncode(signature.userid);
        if (!userid) {
            userid = self.getMessage('keyInfoKeyId') + ': ' + signature.keyid.toHex();
        }
        var desc = signature.valid ? AjxMessageFormat.format(self.getMessage('goodSignatureFrom'), userid) : AjxMessageFormat.format(self.getMessage('badSignatureFrom'), userid);

        var htmls = [];
        htmls.push(AjxMessageFormat.format('<span style="color: {0};">', signature.valid ? 'green' : 'red'));
        htmls.push(AjxMessageFormat.format('<img class="OpenPGPSecureImage" src="{0}" />', self.getResource(signature.valid ? 'imgs/valid.png' : 'imgs/corrupt.png')));
        htmls.push(desc);
        htmls.push('</span>');

        var output = htmls.join('');
        var headerIds = self._msgDivCache[msg.id] = self._msgDivCache[msg.id] || [];
        if (headerIds && headerIds.length) {
            for (var i = 0; i < headerIds.length; i++) {
                var el = Dwt.byId(headerIds[i]);
                if (el) {
                    el.innerHTML = output;
                }
            }
        }

        var id = Dwt.getNextId();
        headerIds.push(id);
        if (Dwt.byId((view._hdrTableId + '-signature-info'))) return;

        var params = {
            info: output,
            id: view._hdrTableId + '-signature-info'
        };
        var html = AjxTemplate.expand('openpgp_zimbra_secure#securityHeader', params);

        var hdrTable = Dwt.byId(view._hdrTableId);
        hdrTable.firstChild.appendChild(Dwt.parseHtmlFragment(html, true));
    });

    if (pgpMessage.encrypted) {
        var el = Dwt.byId(view._attLinksId);
        if (el) {
            return;
        }

        var attachments = [];
        OpenPGPUtils.visitMessage(pgpMessage, function(message) {
            var cd = message.header('Content-Disposition');
            if (cd === 'attachment' && typeof message._body === 'string') {
                var content;
                var encode = message.header('Content-Transfer-Encoding');
                if (encode === 'base64') {
                    content = OpenPGPUtils.base64Decode(message._body);
                }
                else if (encode === 'quoted-printable') {
                    content = utf8.decode(quotedPrintable.decode(message._body));
                }
                else {
                    content = message._body;
                }

                var ct = message.contentType();
                var attachment = {
                    id: OpenPGPUtils.randomString(),
                    type: ct.fulltype,
                    name: 'attachment',
                    size: content.length,
                    content: message._body,
                    raw: content
                };
                if (ct.params.name) {
                    attachment.name = ct.params.name;
                }
                attachments.push(attachment);
                self._pgpAttachments[attachment.id] = attachment;
            }
        });

        if (attachments.length > 0) {
            var numFormatter = AjxNumberFormat.getInstance();
            var msgBody = Dwt.byId(view._msgBodyDivId);
            var div = document.createElement('div');
            div.id = view._attLinksId;
            div.className = 'attachments';

            var linkId = '';
            var attLinkIds = [];
            var htmlArr = [];
            htmlArr.push('<table id="' + view._attLinksId + '_table" cellspacing="0" cellpadding="0" border="0">');
            attachments.forEach(function(attachment, index) {
                htmlArr.push('<tr><td>');
                htmlArr.push('<table border=0 cellpadding=0 cellspacing=0 style="margin-right:1em; margin-bottom:1px"><tr>');
                htmlArr.push('<td style="width:18px">');

                var clientVersion = OpenPGPZimbraSecure.getClientVersion();
                var mimeInfo = ZmMimeTable.getInfo(attachment.type);
                if (clientVersion.indexOf('8.7.0_GA') >= 0 || clientVersion.indexOf('8.7.1_GA') >= 0) {
                    htmlArr.push(AjxImg.getImageHtml({
                        imageName: mimeInfo ? mimeInfo.image : 'GenericDoc',
                        styles: 'position:relative;',
                        altText: ZmMsg.attachment
                    }));
                }
                else {
                    htmlArr.push(AjxImg.getImageHtml(mimeInfo ? mimeInfo.image : 'GenericDoc', 'position:relative;', null, false, false, null, ZmMsg.attachment));
                }
                htmlArr.push('</td><td style="white-space:nowrap">');

                var content = attachment.content.replace(/\r?\n/g, '');
                var linkAttrs = [
                    'class="AttLink"',
                    'href="javascript:;//' + attachment.name + '"',
                    'data-id="' + attachment.id + '"'
                ].join(' ');
                htmlArr.push('<span class="Object" role="link">');
                linkId = view._attLinksId + '_' + msg.id + '_' + index + '_name';
                htmlArr.push('<a id="' + linkId + '" ' + linkAttrs + ' title="' + attachment.name + '">' + attachment.name + '</a>');
                attLinkIds.push(linkId);
                htmlArr.push('</span>');

                if (attachment.size < 1024) {
                    size = numFormatter.format(attachment.size) + ' ' + ZmMsg.b;
                }
                else if (attachment.size < (1024 * 1024)) {
                    size = numFormatter.format(Math.round((attachment.size / 1024) * 10) / 10) + ' ' + ZmMsg.kb;
                }
                else {
                    size = numFormatter.format(Math.round((attachment.size / (1024 * 1024)) * 10) / 10) + ' ' + ZmMsg.mb;
                }
                htmlArr.push('&nbsp;(' + size + ')&nbsp;');

                htmlArr.push('|&nbsp;');
                linkId = view._attLinksId + '_' + msg.id + '_' + index + '_download';
                htmlArr.push('<a id="' + linkId + '" ' + linkAttrs + ' style="text-decoration:underline" title="' + ZmMsg.download + '">' + ZmMsg.download + '</a>');
                attLinkIds.push(linkId);

                htmlArr.push('</td></tr></table>');
                htmlArr.push('</td></tr>');
            });
            htmlArr.push('</table>');

            div.innerHTML = htmlArr.join('');
            msgBody.parentNode.insertBefore(div, msgBody);

            attLinkIds.forEach(function(id) {
                var link = Dwt.byId(id);
                if (link) {
                    link.onclick = function() {
                        self._download(this);
                    };
                }
            });
        }
    }

    if (pgpMessage.hasPGPKey) {
        var pgpKey = pgpMessage.pgpKey;
        if (!pgpKey) {
            OpenPGPUtils.visitMessage(pgpMessage, function(message) {
                var ct = message.contentType();
                if (OpenPGPUtils.isPGPKeysContentType(ct.fulltype)) {
                    pgpKey = message.toString({noHeaders: true});
                }
            });
        }
        if (pgpKey) {
            var pubKey = openpgp.key.readArmored(pgpKey);
            pubKey.keys.forEach(function(key) {
                if (key.isPublic() && !self._keyStore.publicKeyExisted(key.primaryKey.fingerprint)) {
                    var dialog = self._keyImportDialog = new ImportPublicKeyDialog(
                        self,
                        function(dialog) {
                            self._keyStore.addPublicKey(key);
                            self.displayStatusMessage(self.getMessage('publicKeyImported'));
                        },
                        false,
                        OpenPGPSecureKeyStore.keyInfo(key)
                    );
                    dialog.popup();
                }
            });
        }
    }
};

/**
 * This method gets called by the Zimlet framework when a toolbar is created.
 *
 * @param {ZmApp} app
 * @param {ZmButtonToolBar} toolbar
 * @param {ZmController} controller
 * @param {String} viewId
 */
OpenPGPZimbraSecure.prototype.initializeToolbar = function(app, toolbar, controller, viewId) {
    if (viewId.indexOf('COMPOSE') >= 0) {
        var button;
        var children = toolbar.getChildren();
        for (var i = 0; i < children.length && !button; i++) {
            if (Dwt.hasClass(children[i].getHtmlElement(), OpenPGPZimbraSecure.BUTTON_CLASS)) {
                button = children[i];
                break;
            }
        }
        var selectedValue;
        var enableSecurityButton = true;
        var msg = controller.getMsg();
        if (msg && msg.isInvite()) {
            selectedValue = OpenPGPZimbraSecure.OPENPGP_DONTSIGN;
            enableSecurityButton = false;
        } else if (msg && msg.isDraft) {
            selectedValue = OpenPGPZimbraSecure.OPENPGP_DONTSIGN;
        } else {
            selectedValue = this._getSecuritySetting();
        }
        if (!button) {
            var index = AjxUtil.indexOf(toolbar.opList, ZmOperation.COMPOSE_OPTIONS) + 1;
            var id = Dwt.getNextId() + '_' + OpenPGPZimbraSecure.BUTTON_CLASS;
            
            var securityButton = new DwtToolBarButton({
                parent: toolbar,
                id: id + '_checkbox',
                index: index,
                className: OpenPGPZimbraSecure.BUTTON_CLASS + ' ZToolbarButton'
            });

            var securityMenu = new DwtMenu({
                parent: securityButton,
                id: id + '_menu'
            });
            var signingRadioId = id + '_menu_sign';

            securityButton.setMenu(securityMenu);

            var listener = new AjxListener(this, this._handleSelectSigning, [securityButton]);

            var nosignButton = new DwtMenuItem({parent: securityMenu, style: DwtMenuItem.RADIO_STYLE, radioGroupId: signingRadioId});
            nosignButton.setText(this.getMessage('dontSignMessage'));
            nosignButton.addSelectionListener(listener);
            nosignButton.setData('sign', OpenPGPZimbraSecure.OPENPGP_DONTSIGN);

            var signButton = new DwtMenuItem({parent: securityMenu, style: DwtMenuItem.RADIO_STYLE, radioGroupId: signingRadioId});
            signButton.setText(this.getMessage('signMessage'));
            signButton.addSelectionListener(listener);
            signButton.setData('sign', OpenPGPZimbraSecure.OPENPGP_SIGN);

            var signAndEncryptButton = new DwtMenuItem({parent: securityMenu, style: DwtMenuItem.RADIO_STYLE, radioGroupId: signingRadioId});
            signAndEncryptButton.setText(this.getMessage('signAndEncryptMessage'));
            signAndEncryptButton.addSelectionListener(listener);
            signAndEncryptButton.setData('sign', OpenPGPZimbraSecure.OPENPGP_SIGNENCRYPT);

            securityMenu.checkItem('sign', selectedValue, true);
            this._setSecurityImage(securityButton, selectedValue);
            securityButton.setEnabled(enableSecurityButton);
        } else {
            var menu = button.getMenu();
            if (menu) {
                menu.checkItem('sign', selectedValue, true);
                this._setSecurityImage(button, selectedValue);
            }
            button.setEnabled(enableSecurityButton);
        }
    }
};

OpenPGPZimbraSecure.prototype.onSendButtonClicked = function(controller, msg) {
}

OpenPGPZimbraSecure.prototype._setSecurityImage = function(button, value) {
    var security_types = {};
    security_types[OpenPGPZimbraSecure.OPENPGP_DONTSIGN] = {label: this.getMessage('dontSignMessage'), className: 'PGPDontSign'};
    security_types[OpenPGPZimbraSecure.OPENPGP_SIGN] = {label: this.getMessage('signMessage'), className: 'PGPSign'};
    security_types[OpenPGPZimbraSecure.OPENPGP_SIGNENCRYPT] = {label: this.getMessage('signAndEncryptMessage'), className: 'PGPSignEncrypt'};

    if (security_types[value]) {
        button.setImage(security_types[value].className);
        button.setText(security_types[value].label);
    }
    else {
        button.setImage('DontSign');
        button.setText(this.getMessage('dontSignMessage'));
    }
};

/*
 * Event handler for select signing button on toolbar
 */
OpenPGPZimbraSecure.prototype._handleSelectSigning = function(button, ev) {
    var value = ev.dwtObj.getData('sign');

    this._setSecurityImage(button, value);

    var view = appCtxt.getCurrentView();
    var composeCtrl = view && view.getController && view.getController();

    // hide upload button form to suppress HTML5 file upload dialogs
    OpenPGPZimbraSecure._fixFormVisibility(view._attButton.getHtmlElement(), value == OpenPGPZimbraSecure.OPENPGP_DONTSIGN);

    this.setUserProperty(OpenPGPZimbraSecure.USER_SECURITY, value);
    this.saveUserProperties();
    composeCtrl.saveDraft(ZmComposeController.DRAFT_TYPE_AUTO);
};

OpenPGPZimbraSecure._fixFormVisibility = function(element, visible) {
    if (AjxEnv.supportsHTML5File) {
        var forms = element.getElementsByTagName('form');

        for (var i = 0; i < forms.length; i++) {
            Dwt.setVisible(forms.item(i), visible);
        }
    }
};

OpenPGPZimbraSecure.prototype._getSecurityButtonFromToolbar = function(toolbar) {
    var children = toolbar.getChildren();
    for (var i = 0; i < children.length; i++) {
        if (Dwt.hasClass(children[i].getHtmlElement(), OpenPGPZimbraSecure.BUTTON_CLASS)) {
            return children[i];
        }
    }
};

OpenPGPZimbraSecure.prototype._getUserSecuritySetting = function(ctlr, useToolbarOnly) {
    var app = appCtxt.getApp('Mail');
    AjxDispatcher.require(['MailCore','Mail']);
    var view = appCtxt.getAppViewMgr().getCurrentView();
    ctlr = ctlr || (view && view.isZmComposeView && view.getController());
    if (!useToolbarOnly) {
        ctlr = ctlr || app.getComposeController(app.getCurrentSessionId('COMPOSE'));
    }
    var toolbar = ctlr && ctlr._toolbar;
    var button = toolbar && this._getSecurityButtonFromToolbar(toolbar);
    var menu = button && button.getMenu();

    if (menu) {
        return menu.getSelectedItem().getData('sign');
    } else if (useToolbarOnly) {
        //only local setting is requested.
        return false;
    } else {
        return this._getSecuritySetting();
    }
};

OpenPGPZimbraSecure.prototype._getSecuritySetting = function() {
    if (appCtxt.isChildWindow) {
        return window.opener.appCtxt.getZimletMgr().getZimletByName('openpgp_zimbra_secure').handlerObject._getUserSecuritySetting();
    } else {
        var setting = appCtxt.get(OpenPGPZimbraSecure.PREF_SECURITY);
        if (setting == OpenPGPZimbraSecure.OPENPGP_AUTO) {
            return this.getUserProperty(OpenPGPZimbraSecure.USER_SECURITY) || OpenPGPZimbraSecure.OPENPGP_DONTSIGN;
        } else {
            return setting;
        }
    }
};

OpenPGPZimbraSecure.prototype._shouldSign = function(ctlr, useToolbarOnly) {
    var value = this._getUserSecuritySetting(ctlr, useToolbarOnly);
    return (value == OpenPGPZimbraSecure.OPENPGP_SIGN || value == OpenPGPZimbraSecure.OPENPGP_SIGNENCRYPT);
};

OpenPGPZimbraSecure.prototype._shouldEncrypt = function(ctlr, useToolbarOnly) {
    return this._getUserSecuritySetting(ctlr, useToolbarOnly) == OpenPGPZimbraSecure.OPENPGP_SIGNENCRYPT;
};

OpenPGPZimbraSecure.prototype._addJsScripts = function(scripts, callback) {
    return AjxInclude(scripts, null, callback);
};

OpenPGPZimbraSecure.prototype._initOpenPGP = function() {
    var self = this;
    var sequence = Promise.resolve();
    sequence.then(function() {
        var path = self.getResource('js/openpgpjs/openpgp.worker.min.js');
        openpgp.initWorker({
            path: path
        });
        return self._keyStore.init();
    })
    .then(function() {
        OpenPGPSecurePrefs.init(self);
    });
};

OpenPGPZimbraSecure.importAttachmentKey = function(name, url) {
    var callback = new AjxCallback(function(response) {
        if (response.success) {
            var handler = OpenPGPZimbraSecure.getInstance();
            var data = OpenPGPUtils.base64Decode(response.text);
            var pubKey = openpgp.key.readArmored(data);
            pubKey.keys.forEach(function(key) {
                if (key.isPublic() && !handler.getKeyStore().publicKeyExisted(key.primaryKey.fingerprint)) {
                    var dialog = handler._keyImportDialog = new ImportPublicKeyDialog(
                        handler,
                        function(dialog) {
                            handler.getKeyStore().addPublicKey(key);
                            handler.displayStatusMessage(handler.getMessage('publicKeyImported'));
                        },
                        false,
                        OpenPGPSecureKeyStore.keyInfo(key)
                    );
                    dialog.popup();
                }
            });
        }
    });

    AjxRpc.invoke('', url, {
        'X-Zimbra-Encoding': 'x-base64'
    }, callback, true);
}

OpenPGPZimbraSecure.decryptAttachment = function(name, url) {
    var callback = new AjxCallback(function(response) {
        if (response.success) {
            var handler = OpenPGPZimbraSecure.getInstance();
            var data = OpenPGPUtils.base64Decode(response.text);
            if (OpenPGPUtils.hasInlinePGPContent(data, OpenPGPUtils.OPENPGP_MESSAGE_HEADER)) {
                var opts = {
                    message: openpgp.message.readArmored(data),
                    privateKey: handler.getKeyStore().getPrivateKey()
                };
            }
            else {
                var opts = {
                    message: openpgp.message.read(OpenPGPUtils.stringToArray(data)),
                    privateKey: handler.getKeyStore().getPrivateKey()
                };
            }
            openpgp.decrypt(opts).then(function(plainText) {
                OpenPGPUtils.saveAs(plainText.data, name, 'application/octet-stream');
            });
        }
    });

    AjxRpc.invoke('', url, {
        'X-Zimbra-Encoding': 'x-base64'
    }, callback, true);
}

OpenPGPZimbraSecure.prototype._download = function(element) {
    var id = Dwt.getAttr(element, 'data-id');
    if (id && this._pgpAttachments[id]) {
        var attachment = this._pgpAttachments[id];
        var content = OpenPGPUtils.base64Decode(attachment.content);
        OpenPGPUtils.saveAs(content, attachment.name, attachment.type);
    }
}

OpenPGPZimbraSecure.popupErrorDialog = function(errorCode){
    if(!errorCode){
        errorCode = 'unknown-error';
    }
    var msg = OpenPGPUtils.getMessage(errorCode);
    var title = OpenPGPUtils.getMessage(errorCode + '-title');

    var dialog = appCtxt.getHelpMsgDialog();
    dialog.setMessage(msg, DwtMessageDialog.CRITICAL_STYLE, title);
    dialog.setHelpURL(appCtxt.get(ZmSetting.SMIME_HELP_URI));
    dialog.popup();
};

OpenPGPZimbraSecure.getInstance = function() {
    return appCtxt.getZimletMgr().getZimletByName('openpgp_zimbra_secure').handlerObject;
};

OpenPGPZimbraSecure.getClientVersion = function() {
    return appCtxt.get(ZmSetting.CLIENT_VERSION);
};

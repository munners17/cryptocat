﻿$(window).ready(function() {

/* Version number */
Cryptocat.version = '2.0.26';
$('#version').text(Cryptocat.version);

/* Configuration */
var defaultDomain = 'crypto.cat'; // Domain name to connect to for XMPP.
var defaultConferenceServer = 'conference.crypto.cat'; // Address of the XMPP MUC server.
var defaultBOSH = 'https://crypto.cat/http-bind'; // BOSH is served over an HTTPS proxy for better security and availability.
var fileSize = 700; // Maximum encrypted file sharing size, in kilobytes. Also needs to be defined in datareader.js
var localStorageOn = 0; // Disabling localStorage features until Firefox bug #795615 is fixed
var groupChat = 1; // Enable/disable group chat client functionality.

/* Initialization */
var domain = defaultDomain;
var conferenceServer = defaultConferenceServer;
var bosh = defaultBOSH;
var otrKeys = {};
var conversations = {};
var loginCredentials = [];
var currentConversation = 0;
var audioNotifications = 0;
var desktopNotifications = 0;
var buddyNotifications = 0;
var loginError = 0;
var windowFocus = 1;
var currentStatus = 'online';
var soundEmbed = null;
var conn, conversationName, myNickname, myKey;
if (!groupChat) { $('#buddy-main-Conversation').remove(); }

// Initialize language settings
var language = window.navigator.language.toLowerCase();
Language.set(language);

// Check if localStorage is implemented
try {
	localStorage.getItem('test');
}
catch(error) {
	localStorageOn = 0;
}

// If localStorage is implemented, load saved settings
if (localStorageOn) {
	// Load language settings
	if (localStorage.getItem('language') !== null) {
		Language.set(localStorage.getItem('language'));
		$('#languages').val(localStorage.getItem('language'));
	}
	// Load nickname settings
	if (localStorage.getItem('rememberNickname') === 'rememberNickname') {
		$('#nickname').val(localStorage.getItem('myNickname'));
	}
	else {
		localStorage.getItem('rememberNickname', 'doNotRememberNickname');
		localStorage.getItem('myNickname');
	}
	// Load custom server settings
	if (localStorage.getItem('domain')) {
		domain = localStorage.getItem('domain');
	}
	if (localStorage.getItem('conferenceServer')) {
		conferenceServer = localStorage.getItem('conferenceServer');
	}
	if (localStorage.getItem('bosh')) {
		bosh = localStorage.getItem('bosh');
	}
	// Load pre-existing encryption keys
	if (localStorage.getItem('myKey') !== null) {
		myKey = JSON.parse(localStorage.getItem('myKey'));
		DSA.inherit(myKey);
		multiParty.setPrivateKey(localStorage.getItem('multiPartyKey'));
		multiParty.genPublicKey();
	}
}

// Handle window focus/blur
$(window).blur(function() {
	windowFocus = 0;
});
$(window).focus(function() {
	windowFocus = 1;
	document.title = 'Cryptocat';
});

// Initialize workers
var keyGenerator = new Worker('js/keygenerator.js');
var dataReader = new Worker('js/datareader.js');
keyGenerator.onmessage = function(e) {
	myKey = e.data;
	if (localStorageOn) {
		localStorage.setItem('myKey', JSON.stringify(myKey));
	}
	DSA.inherit(myKey);
	$('#fill').stop().animate({'width': '100%', 'opacity': '1'}, 400, 'linear', function() {
		$('#loginInfo').text(Cryptocat.language['loginMessage']['connecting']);
		$('#dialogBoxClose').click();
	});
}

// Outputs the current hh:mm.
// If `seconds = 1`, outputs hh:mm:ss.
function currentTime(seconds) {
	var date = new Date();
	var time = [];
	time.push(date.getHours().toString());
	time.push(date.getMinutes().toString());
	if (seconds) {
		time.push(date.getSeconds().toString());
	}
	for (var just in time) {
		if (time[just].length === 1) {
			time[just] = '0' + time[just];
		}
	}
	return time.join(':');
}

// Plays the audio file defined by the `audio` variable.
function playSound(audio) {
	(new Audio('snd/' + audio + '.webm')).play();
}

// Scrolls down the chat window to the bottom in a smooth animation.
// 'speed' is animation speed in milliseconds.
function scrollDown(speed) {
	$('#conversationWindow').animate({
		scrollTop: $('#conversationWindow')[0].scrollHeight + 20
	}, speed);
}

// Initiates a conversation. Internal use.
function initiateConversation(conversation) {
	if (!conversations.hasOwnProperty(conversation)) {
		conversations[conversation] = '';
	}
}

// OTR functions
// Handle incoming messages
var uicb = function(buddy) {
	return function(error, message) {
		if (error) {
			return console.log('OTR error: ' + error);
		}
		addToConversation(message, buddy, buddy);
	}
}

// Handle outgoing messages
var iocb = function(buddy) {
	return function(message) {
		conn.muc.message(conversationName + '@' + conferenceServer, buddy, message, null);
	}
}

// Creates a template for the conversation info bar at the top of each conversation.
function buildConversationInfo(conversation) {
	$('#conversationInfo').html(
		'<span class="conversationUserCount">' + $('.buddy').length + '</span>'
		+ '<span class="conversationName">' + myNickname + '@' + conversationName + '</span>'
	);
	if (conversation === 'main-Conversation') {
		$('#conversationInfo').append(
			'<span style="float:right">' + Cryptocat.language['chatWindow']['groupConversation'] + '</span>'
		);
	}
}

// Switches the currently active conversation to `buddy'
function switchConversation(buddy) {
	if ($('#buddy-' + buddy).attr('status') !== 'offline') {
		$('#' + buddy).animate({'background-color': '#97CEEC'});
		$('#buddy-' + buddy).css('border-bottom', '1px solid #76BDE5');
	}
	if (buddy !== 'main-Conversation') {
		$('#buddy-' + buddy).css('background-image', 'none');
	}
	$('#conversationInfo').animate({'width': '750px'}, function() {
		$('#conversationWindow').slideDown('fast', function() {
			buildConversationInfo(currentConversation);
			$('#userInput').fadeIn('fast', function() {
				$('#userInputText').focus();
			});
			var scrollWidth = document.getElementById('conversationWindow').scrollWidth;
			$('#conversationWindow').css('width', (712 + scrollWidth) + 'px');
			scrollDown(600);
		});
	});
	// Clean up finished conversations
	$('#buddyList div').each(function() {
		if (($(this).attr('id') !== ('buddy-' + currentConversation))
			&& ($(this).css('background-image') === 'none')
			&& ($(this).attr('status') === 'offline')) {
			$(this).slideUp(500, function() {
				$(this).remove();
				updateUserCount();
			});
		}
	});
}

// Handles login failures
function loginFail(message) {
	buddyNotifications = 0;
	$('#loginInfo').text(message);
	$('#bubble').animate({'left': '+=5px'}, 130)
		.animate({'left': '-=10px'}, 130)
		.animate({'left': '+=5px'}, 130);
	$('#loginInfo').animate({'color': '#E93028'}, 'fast');
}

// Generates a random string of length `size` characters.
// If `alpha = 1`, random string will contain alpha characters, and so on.
// If 'hex = 1', all other settings are overridden.
Cryptocat.randomString = function(size, alpha, uppercase, numeric, hex) {
	var keyspace = '';
	var result = '';
	if (alpha) {
		keyspace += 'abcdefghijklmnopqrstuvwxyz';
	}
	if (uppercase) {
		keyspace += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	}
	if (numeric) {
		keyspace += '0123456789';
	}
	if (hex) {
		keyspace = '0123456789abcdef';
	}
	for (var i = 0; i !== size; i++) {
		result += keyspace[Math.floor(Cryptocat.random()*keyspace.length)];
	}
	return result;
}

// Simply shortens a string `string` to length `length.
// Adds '..' to delineate that string was shortened.
function shortenString(string, length) {
	if (string.length > length) {
		return string.substring(0, (length - 2)) + '..';
	}
	return string;
}

// Clean nickname so that it's safe to use.
function cleanNickname(nickname) {
	var clean;
	if (clean = nickname.match(/\/([\s\S]+)/)) {
		clean = Strophe.xmlescape(clean[1]);
	}
	else {
		return false;
	}
	if (clean.match(/\W/)) {
		return false;
	}
	return clean;
}

// Get a fingerprint, formatted for readability
function getFingerprint(buddy, OTR) {
	if (OTR) {
		if (buddy === myNickname) {
			var fingerprint = myKey.fingerprint();
		}
		else {
			var fingerprint = otrKeys[buddy].their_priv_pk.fingerprint();
		}
	}
	else {
		if (buddy === myNickname) {
			var fingerprint = multiParty.genFingerprint();
		}
		else {
			var fingerprint = multiParty.genFingerprint(buddy);
		}
	}
	var formatted = '';
	for (var i in fingerprint) {
		if ((i !== 0) && !(i % 8)) {
			formatted += ' ';
		}
		formatted += fingerprint[i];
	}
	return formatted.toUpperCase();
}

// Convert message URLs to links. Used internally.
function addLinks(message) {
	if ((URLs = message.match(/((mailto\:|(news|(ht|f)tp(s?))\:\/\/){1}\S+)/gi))) {
		for (var i in URLs) {
			var sanitize = URLs[i].split('');
			for (var l in sanitize) {
				if (!sanitize[l].match(/\w|\d|\:|\/|\?|\=|\#|\+|\,|\.|\&|\;|\%/)) {
					sanitize[l] = encodeURIComponent(sanitize[l]);
				}
			}
			sanitize = sanitize.join('');
			var processed = sanitize.replace(':','&colon;');
			message = message.replace(sanitize, '<a target="_blank" href="' + processed + '">' + processed + '</a>');		
		}
	}
	return message;
}

// Convert text emoticons to graphical emoticons.
function addEmoticons(message) {
	return message
		.replace(/(\s|^)(:|(=))-?3(?=(\s|$))/gi, ' <div class="emoticon" id="eCat">$&</div> ')
		.replace(/(\s|^)(:|(=))-?\&apos;\((?=(\s|$))/gi, ' <div class="emoticon" id="eCry">$&</div> ')
		.replace(/(\s|^)(:|(=))-?o(?=(\s|$))/gi, ' <div class="emoticon" id="eGasp">$&</div> ')
		.replace(/(\s|^)(:|(=))-?D(?=(\s|$))/gi, ' <div class="emoticon" id="eGrin">$&</div> ')
		.replace(/(\s|^)(:|(=))-?\((?=(\s|$))/gi, ' <div class="emoticon" id="eSad">$&</div> ')
		.replace(/(\s|^)(:|(=))-?\)(?=(\s|$))/gi, ' <div class="emoticon" id="eSmile">$&</div> ')
		.replace(/(\s|^)-_-(?=(\s|$))/gi, ' <div class="emoticon" id="eSquint">$&</div> ')
		.replace(/(\s|^)(:|(=))-?p(?=(\s|$))/gi, ' <div class="emoticon" id="eTongue">$&</div> ')
		.replace(/(\s|^)(:|(=))-?(\/|s)(?=(\s|$))/gi, ' <div class="emoticon" id="eUnsure">$&</div> ')
		.replace(/(\s|^);-?\)(?=(\s|$))/gi, ' <div class="emoticon" id="eWink">$&</div> ')
		.replace(/(\s|^);-?\p(?=(\s|$))/gi, ' <div class="emoticon" id="eWinkTongue">$&</div> ')
		.replace(/(\s|^)\^(_|\.)?\^(?=(\s|$))/gi, ' <div class="emoticon" id="eYay">$&</div> ')
		.replace(/(\s|^)(:|(=))-?x\b(?=(\s|$))/gi, ' <div class="emoticon" id="eShut">$&</div> ')
		.replace(/(\s|^)\&lt\;3\b(?=(\s|$))/g, ' <span class="monospace">&#9829;</span> ');
}

// Convert Data URI to viewable/downloadable file.
// Warning: This function is currently unused and is probably not secure for use.
function addFile(message) {
	var mime = new RegExp('(data:(application\/((x-compressed)|(x-zip-compressed)|'
		+ '(zip)))|(multipart\/x-zip))\;base64,(\\w|\\/|\\+|\\=|\\s)*$');
		
	if (match = message.match(/data:image\/\w+\;base64,(\w|\\|\/|\+|\=)*$/)) {
		message = message.replace(/data:image\/\w+\;base64,(\w|\\|\/|\+|\=)*$/,
			'<a href="' + match[0] + '" class="imageView" target="_blank">' + Cryptocat.language['chatWindow']['viewImage'] + '</a>');
	}
	else if (match = message.match(mime)) {
		message = message.replace(mime,
			'<a href="' + match[0] + '" class="fileView" target="_blank">' + Cryptocat.language['chatWindow']['downloadFile'] + '</a>');
	}
	return message;
}

// Add a `message` from `sender` to the `conversation` display and log.
function addToConversation(message, sender, conversation) {
	if (!message) {
		return false;
	}
	initiateConversation(conversation);
	if (sender === myNickname) {
		lineDecoration = 1;
		audioNotification = 'msgSend';
		message = Strophe.xmlescape(message);
	}
	else {
		lineDecoration = 2;
		audioNotification = 'msgGet';
		if (desktopNotifications) {
			if ((conversation !== currentConversation) || (!windowFocus)) {
				Notification.createNotification('img/keygen.gif', sender, message);
			}
		}
		message = Strophe.xmlescape(message);
		if (message.match(myNickname)) {
			var nickRegEx = new RegExp(myNickname, 'g');
			message = message.replace(nickRegEx, '<span class="nickHighlight">$&</span>');
			lineDecoration = 3;
		}
	}
	// message = addFile(message); Function disabled
	message = addLinks(message);
	message = addEmoticons(message);
	message = message.replace(/:/g, '&#58;');
	var timeStamp = '<span class="timeStamp">' + currentTime(0) + '</span>';
	var sender = '<span class="sender">' + Strophe.xmlescape(shortenString(sender, 16)) + '</span>';
	message = '<div class="Line' + lineDecoration + '">' + timeStamp + sender + message + '</div>';
	conversations[conversation] += message;
	if (conversation === currentConversation) {
		$('#conversationWindow').append(message);
	}
	else {
		var backgroundColor = $('#buddy-' + conversation).css('background-color');
		$('#buddy-' + conversation).css('background-image', 'url("img/newMessage.png")');
		$('#buddy-' + conversation)
			.animate({'backgroundColor': '#A7D8F7'})
			.animate({'backgroundColor': backgroundColor});
	}
	if (audioNotifications) {
		playSound(audioNotification);
	}
	if (($('#conversationWindow')[0].scrollHeight - $('#conversationWindow').scrollTop()) < 1500) {	
		scrollDown(600);
	}
}

// Add a join/part notification to the main conversation window.
// If 'join === 1', shows join notification, otherwise shows part
function buddyNotification(buddy, join) {
	var timeStamp = '<span class="timeStamp">' + currentTime(0) + '</span>';
	if (join) {
		var status = '<div class="userJoin"><strong>+</strong>' + buddy + '</div>';
		var audioNotification = 'userOnline';
	}
	else {
		var status = '<div class="userLeave"><strong>-</strong>' + buddy + '</div>';
		var audioNotification = 'userOffline';
	}
	var message = '<div class="Line2">' + timeStamp + status + '</div>';
	conversations['main-Conversation'] += message;
	if (currentConversation === 'main-Conversation') {
		$('#conversationWindow').append(message);
	}
	if (($('#conversationWindow')[0].scrollHeight - $('#conversationWindow').scrollTop()) < 1500) {	
		scrollDown(600);
	}
	//if (desktopNotifications) {
	//	if ((currentConversation !== 'main-Conversation') || (!windowFocus)) {
	//		Notification.createNotification('img/keygen.gif', buddy, status);
	//	}
	//}
	if (audioNotifications) {
		playSound(audioNotification);
	}
}

// Update user count for display in conversation info bar.
function updateUserCount() {
	if ($('.conversationUserCount').text() !== $('.buddy').length.toString()) {
		$('.conversationUserCount').animate({'color': '#70B9E0'}, function() {
			$(this).text($('.buddy').length);
			$(this).animate({'color': '#FFF'});
		});	
	}
}

// Build new buddy
function addBuddy(nickname) {
	$('#buddyList').queue(function() {
		var buddyTemplate = '<div class="buddy" title="' + nickname + '" id="buddy-' 
			+ nickname + '" status="online"><span>' + nickname + '</span>'
			+ '<div class="buddyMenu" id="menu-' + nickname + '"></div></div>'
		$(buddyTemplate).insertAfter('#buddiesOnline').slideDown(100, function() {
			$('#buddy-' + nickname).unbind('click');
			$('#menu-' + nickname).unbind('click');
			bindBuddyMenu(nickname);
			bindBuddyClick(nickname);
			updateUserCount();
			var sendPublicKey = multiParty.sendPublicKey(nickname);
			conn.muc.message(
				conversationName + '@' + conferenceServer, null,
				sendPublicKey, null
			);
		});
		if (buddyNotifications) {
			buddyNotification(nickname, 1);
		}
	});
	$('#buddyList').dequeue();
}

// Handle buddy going offline
function removeBuddy(nickname) {
	// Delete their encryption keys
	delete otrKeys[nickname];
	multiParty.removeKeys(nickname);
	if (($('#buddy-' + nickname).length !== 0)
		&& ($('#buddy-' + nickname).attr('status') !== 'offline')) {
		if ((currentConversation !== nickname)
			&& ($('#buddy-' + nickname).css('background-image') === 'none')) {
			$('#buddy-' + nickname).slideUp(500, function() {
				$(this).remove();
				updateUserCount();
			});
		}
		else {
			$('#buddy-' + nickname).attr('status', 'offline');
			$('#buddy-' + nickname).animate({
				'color': '#BBB',
				'backgroundColor': '#222',
				'borderLeftColor': '#111',
				'borderBottom': 'none'
			});
		}
	}
	if (buddyNotifications) {
		buddyNotification(nickname, 0);
	}
}

// Handle nickname change (which may be done by non-Cryptocat XMPP clients)
function changeNickname(oldNickname, newNickname) {
	otrKeys[newNickname] = otrKeys[oldNickname];
	multiParty.renameKeys(oldNickname, newNickname);
	conversations[newNickname] = conversations[oldNickname];
	removeBuddy(oldNickname);
}

// Handle incoming messages from the XMPP server.
function handleMessage(message) {
	var nickname = cleanNickname($(message).attr('from'));
	var body = $(message).find('body').text().replace(/\&quot;/g, '"');
	var type = $(message).attr('type');
	// If archived message, ignore.
	if ($(message).find('delay').length !== 0) {
		return true;
	}
	// If message is from me, ignore.
	if (nickname === myNickname) {
		return true;
	}
	// If message is from someone not on buddy list, ignore.
	if (!$('#buddy-' + nickname).length) {
		return true;
	}
	if (type === 'groupchat' && groupChat) {
		body = multiParty.receiveMessage(nickname, myNickname, body);
		if (typeof(body) === 'string') {
			addToConversation(body, nickname, 'main-Conversation');
		}
	}
	else if (type === 'chat') {
		otrKeys[nickname].receiveMsg(body);
	}
	return true;
}

// Handle incoming presence updates from the XMPP server.
function handlePresence(presence) {
	// console.log(presence);
	var nickname = cleanNickname($(presence).attr('from'));
	// If invalid nickname, do not process
	if ($(presence).attr('type') === 'error') {
		if ($(presence).find('error').attr('code') === '409') {
			// Delay logout in order to avoid race condition with window animation
			window.setTimeout(function() {
				loginError = 1;
				logout();
				loginFail(Cryptocat.language['loginMessage']['nicknameInUse']);
			}, 3000);
			return false;
		}
		return true;
	}
	// Ignore if presence status is coming from myself
	if (nickname === myNickname) {
		return true;
	}
	// Detect nickname change (which may be done by non-Cryptocat XMPP clients)
	if ($(presence).find('status').attr('code') === '303') {
		var newNickname = cleanNickname('/' + $(presence).find('item').attr('nick'));
		console.log(nickname + ' changed nick to ' + newNickname);
		changeNickname(nickname, newNickname);
		return true;
	}
	// Add to otrKeys if necessary
	if (nickname !== 'main-Conversation' && !otrKeys.hasOwnProperty(nickname)) {
		// var options = {
		// 	fragment_size: 8192,
		// 	send_interval: 400,
		// }
		otrKeys[nickname] = new OTR(myKey, uicb(nickname), iocb(nickname));
		otrKeys[nickname].REQUIRE_ENCRYPTION = true;
	}
	// Detect buddy going offline
	if ($(presence).attr('type') === 'unavailable') {
		removeBuddy(nickname);
		return true;
	}
	// Create buddy element if buddy is new
	else if (!$('#buddy-' + nickname).length) {
		addBuddy(nickname);
	}
	// Handle buddy status change to 'available'
	else if ($(presence).find('show').text() === '' || $(presence).find('show').text() === 'chat') {
		if ($('#buddy-' + nickname).attr('status') !== 'online') {
			var status = 'online';
			var backgroundColor = '#76BDE5';
			var placement = '#buddiesOnline';
		}
	}
	// Handle buddy status change to 'away'
	else if ($('#buddy-' + nickname).attr('status') !== 'away') {
			var status = 'away';
			var backgroundColor = '#5588A5';
			var placement = '#buddiesAway';
	}
	// Perform status change
	$('#buddy-' + nickname).attr('status', status);
	if (placement) {
		$('#buddy-' + nickname).animate({
			'color': '#FFF',
			'backgroundColor': backgroundColor,
			'borderLeftColor': '#97CEEC'
		});
		if (currentConversation !== nickname) {
			$('#buddy-' + nickname).slideUp('fast', function() {
				$(this).insertAfter(placement).slideDown('fast');
			});
		}
	}
	return true;
}

// Bind buddy click actions. Used internally.
function bindBuddyClick(nickname) {
	$('#buddy-' + nickname).click(function() {
		if ($(this).prev().attr('id') === 'currentConversation') {
			$('#userInputText').focus();
			return true;
		}
		if (nickname !== 'main-Conversation') {
			$(this).css('background-image', 'none');
		}
		else {
			$(this).css('background-image', 'url("img/groupChat.png")');
		}
		if (currentConversation) {
			var oldConversation = currentConversation;
			if ($('#buddy-' + oldConversation).attr('status') === 'online') {
				var placement = '#buddiesOnline';
				var backgroundColor = '#76BDE5';
				var color = '#FFF';
			}
			else if ($('#buddy-' + oldConversation).attr('status') === 'away') {
				var placement = '#buddiesAway';
				var backgroundColor = '#5588A5';
				var color = '#FFF';
			}
			$('#buddy-' + oldConversation).slideUp('fast', function() {
				$(this).css('background-color', backgroundColor);
				$(this).css('color', color);
				$(this).css('border-bottom', 'none');
				$(this).insertAfter(placement).slideDown('fast');
			});
		}
		currentConversation = nickname;
		initiateConversation(currentConversation);
		$('#conversationWindow').html(conversations[currentConversation]);
		if (($(this).prev().attr('id') === 'buddiesOnline')
			|| (($(this).prev().attr('id') === 'buddiesAway')
			&& $('#buddiesOnline').next().attr('id') === 'buddiesAway')) {
			$(this).insertAfter('#currentConversation');
			$(this).animate({'background-color': '#97CEEC'});
			switchConversation(nickname);
		}
		else {
			$(this).slideUp('fast', function() {
				$(this).insertAfter('#currentConversation').slideDown('fast', function() {
					$(this).animate({'background-color': '#97CEEC'});
					switchConversation(nickname);
				});
			});
		}
	});
}

// Send encrypted file
// File is converted into a base64 Data URI which is then sent as an OTR message.
function sendFile(nickname) {
	var sendFileDialog = '<div class="bar">' + Cryptocat.language['chatWindow']['sendEncryptedFile'] + '</div>'
		+ '<input type="file" id="fileSelector" name="file[]" />'
		+ '<input type="button" id="fileSelectButton" class="button" value="select file" />'
		+ '<div id="fileErrorField"></div>'
		+ 'Only .zip files and images are accepted.<br />'
		+ 'Maximum file size: ' + fileSize + ' kilobytes.';
	dialogBox(sendFileDialog, 1);
	$('#fileSelector').change(function(e) {
		e.stopPropagation();
		dataReader.onmessage = function(e) {
			if (e.data === 'typeError') {
				$('#fileErrorField').text('Please make sure your file is a .zip file or an image.');
			}
			else if (e.data === 'sizeError') {
				$('#fileErrorField').text('File cannot be larger than ' + fileSize + ' kilobytes');
			}
			else {
				otrKeys[nickname].sendMsg(e.data);
				addToConversation(e.data, myNickname, nickname);
				$('#dialogBoxClose').click();
			}
		};
		if (this.files) {
			dataReader.postMessage(this.files);
		}
	});
	$('#fileSelectButton').click(function() {
		$('#fileSelector').click();
	});
}

// Display buddy information, including fingerprints etc.
function displayInfo(nickname) {
	// Do nothing if a dialog already exists
	if ($('#displayInfo').length) {
		return false;
	}
	nickname = Strophe.xmlescape(nickname);
	var displayInfoDialog = '<input type="button" class="bar" value="'
		+ nickname + '"/><div id="displayInfo">'
		+ Cryptocat.language['chatWindow']['otrFingerprint']
		+ '<br /><span id="otrFingerprint"></span><br />'
		+ '<div id="otrColorprint"></div><br />'
		+ '<br />' + Cryptocat.language['chatWindow']['groupFingerprint']
		+ '<br /><span id="multiPartyFingerprint"></span><br />'
		+ '<div id="multiPartyColorprint"></div><br /></div>';
	// If OTR fingerprints have not been generated, show a progress bar and generate them.
	if ((nickname !== myNickname) && !otrKeys[nickname].msgstate) {
		var progressDialog = '<div id="progressBar"><div id="fill"></div></div>';
		dialogBox(progressDialog, 1, null, function() {
			$('#displayInfo').remove();
		});
		$('#progressBar').css('margin', '70px auto 0 auto');
		$('#fill').animate({'width': '100%', 'opacity': '1'}, 8000, 'linear');
		otrKeys[nickname].sendQueryMsg();
		$(document).bind('otrFingerprintReady', function() {
			$('#fill').stop().animate({'width': '100%', 'opacity': '1'}, 400, 'linear', function() {
				$('#dialogBoxContent').fadeOut(function() {
					$(this).html(displayInfoDialog);
					showFingerprints(nickname);
					$(this).fadeIn();
					$(document).unbind('otrFingerprintReady');
				});
			});
		});
	}
	else {
		dialogBox(displayInfoDialog, 1, null, function() {
			$('#displayInfo').remove();
		});
		showFingerprints(nickname);
	}
	// Show fingerprints internal function
	function showFingerprints(nickname) {
		$('#otrFingerprint').text(getFingerprint(nickname, 1));
		$('#multiPartyFingerprint').text(getFingerprint(nickname, 0));
		var otrColorprint = getFingerprint(nickname, 1).split(' ');
		otrColorprint.splice(0, 1);
		for (var color in otrColorprint) {
			$('#otrColorprint').append(
				'<div class="colorprint" style="background:#' 
				+ otrColorprint[color].substring(0, 6) + '"></div>'
			);
		}
		var multiPartyColorprint = getFingerprint(nickname, 0).split(' ');
		multiPartyColorprint.splice(0, 1);
		for (var color in multiPartyColorprint) {
			$('#multiPartyColorprint').append(
				'<div class="colorprint" style="background:#' 
				+ multiPartyColorprint[color].substring(0, 6) + '"></div>'
			);
		}
	}
}

// Bind buddy menus for new buddies. Used internally.
function bindBuddyMenu(nickname) {
	nickname = Strophe.xmlescape(nickname);
	$('#menu-' + nickname).attr('status', 'inactive');
	$('#menu-' + nickname).click(function(e) {
		e.stopPropagation();
		if ($('#menu-' + nickname).attr('status') === 'inactive') {
			$('#menu-' + nickname).attr('status', 'active');
			var buddyMenuContents = '<div class="buddyMenuContents" id="' + nickname + '-contents">';
			$(this).css('background-image', 'url("img/up.png")');
			$('#buddy-' + nickname).delay(10).animate({'height': '28px'}, 180, function() {
				$(this).append(buddyMenuContents);
				// File sharing menu item
				// (currently disabled)
				// $('#' + nickname + '-contents').append(
				// 	'<li class="option1">' + Cryptocat.language['chatWindow']['sendEncryptedFile']  + '</li>'
				// );
				$('#' + nickname + '-contents').append(
					'<li class="option2">' + Cryptocat.language['chatWindow']['displayInfo'] + '</li>'
				);
				$('#' + nickname + '-contents').fadeIn('fast', function() {
					$('.option1').click(function(e) {
						e.stopPropagation();
						sendFile(nickname);
						$('#menu-' + nickname).click();
					});
					$('.option2').click(function(e) {
						e.stopPropagation();
						displayInfo(nickname);
						$('#menu-' + nickname).click();
					});
				});
			});
		}
		else {
			$('#menu-' + nickname).attr('status', 'inactive');
			$(this).css('background-image', 'url("img/down.png")');
			$('#buddy-' + nickname).animate({'height': '15px'}, 190);
			$('#' + nickname + '-contents').fadeOut('fast', function() {
				$('#' + nickname + '-contents').remove();
			});
		}
	});
}

// Send your current status to the XMPP server.
function sendStatus() {
	if (currentStatus === 'away') {
		conn.muc.setStatus(conversationName + '@' + conferenceServer, myNickname, 'away', 'away');
	}
	else {
		conn.muc.setStatus(conversationName + '@' + conferenceServer, myNickname, '', '');
	}
}

// Displays a pretty dialog box with `data` as the content HTML.
// If `closeable = 1`, then the dialog box has a close button on the top right.
// onAppear may be defined as a callback function to execute on dialog box appear.
// onClose may be defined as a callback function to execute on dialog box close.
function dialogBox(data, closeable, onAppear, onClose) {
	if ($('#dialogBox').css('top') !== '-450px') {
		return false;
	}
	if (closeable) {
		$('#dialogBoxClose').css('width', '18px');
		$('#dialogBoxClose').css('font-size', '12px');
	}
	$('#dialogBoxContent').html(data);
	$('#dialogBox').animate({'top': '+=460px'}, 'fast').animate({
		'top': '-=10px'
	}, 'fast', function() {
		if (onAppear) {
			onAppear();
		}
	});
	$('#dialogBoxClose').unbind('click');
	$('#dialogBoxClose').click(function(e) {
		e.stopPropagation();
		if ($(this).css('width') === 0) {
			return false;
		}
		$('#dialogBox').animate({'top': '+=10px'}, 'fast')
			.animate({'top': '-450px'}, 'fast', function() {
				if (onClose) {
					onClose();
				}
			});
		$(this).css('width', '0');
		$(this).css('font-size', '0');
		$('#userInputText').focus();
	});
	if (closeable) {
		$(document).keydown(function(e) {
			if (e.keyCode === 27) {
				e.stopPropagation();
				$('#dialogBoxClose').click();
				$(document).unbind('keydown');
			}
		});
	}
}

// Buttons
// Status button
$('#status').click(function() {
	if ($(this).attr('title') === Cryptocat.language['chatWindow']['statusAvailable']) {
		$(this).attr('src', 'img/away.png');
		$(this).attr('alt', Cryptocat.language['chatWindow']['statusAway']);
		$(this).attr('title', Cryptocat.language['chatWindow']['statusAway']);
		currentStatus = 'away';
		sendStatus();
	}
	else {
		$(this).attr('src', 'img/available.png');
		$(this).attr('alt', Cryptocat.language['chatWindow']['statusAvailable']);
		$(this).attr('title', Cryptocat.language['chatWindow']['statusAvailable']);
		currentStatus = 'online';
		sendStatus();
	}
});

$('#myInfo').click(function() {
	displayInfo(myNickname);
});

// Desktop notifications button
// If not using Chrome, remove this button
// (Since only Chrome supports desktop notifications)
if (!navigator.userAgent.match('Chrome')) {
	$('#notifications').remove();
}
else {
	$('#notifications').click(function() {
		if ($(this).attr('title') === Cryptocat.language['chatWindow']['desktopNotificationsOff']) {
			$(this).attr('src', 'img/notifications.png');
			$(this).attr('alt', Cryptocat.language['chatWindow']['desktopNotificationsOn']);
			$(this).attr('title', Cryptocat.language['chatWindow']['desktopNotificationsOn']);
			desktopNotifications = 1;
			if (Notification.checkPermission()) {
				Notification.requestPermission();
			}
		}
		else {
			$(this).attr('src', 'img/noNotifications.png');
			$(this).attr('alt', Cryptocat.language['chatWindow']['desktopNotificationsOff']);
			$(this).attr('title', Cryptocat.language['chatWindow']['desktopNotificationsOff']);
			desktopNotifications = 0;
		}
	});
}

// Audio notifications button
// If using Safari, remove this button
// (Since Safari does not support audio notifications)
if (!navigator.userAgent.match(/(Chrome)|(Firefox)/)) {
	$('#audio').remove();
}
$('#audio').click(function() {
	if ($(this).attr('title') === Cryptocat.language['chatWindow']['audioNotificationsOff']) {
		$(this).attr('src', 'img/sound.png');
		$(this).attr('alt', Cryptocat.language['chatWindow']['audioNotificationsOn']);
		$(this).attr('title', Cryptocat.language['chatWindow']['audioNotificationsOn']);
		audioNotifications = 1;
	}
	else {
		$(this).attr('src', 'img/noSound.png');
		$(this).attr('alt', Cryptocat.language['chatWindow']['audioNotificationsOff']);
		$(this).attr('title', Cryptocat.language['chatWindow']['audioNotificationsOff']);
		audioNotifications = 0;
	}
});

// Logout button
$('#logout').click(function() {
	logout();
});

// Submit user input
$('#userInput').submit(function() {
	var message = $.trim($('#userInputText').val());
	if (message !== '') {
		if (currentConversation === 'main-Conversation') {
			if (multiParty.userCount() >= 1) {
				conn.muc.message(
					conversationName + '@' + conferenceServer, null,
					multiParty.sendMessage(message), null
				);
			}
		}
		else {
			otrKeys[currentConversation].sendMsg(message);
		}
		addToConversation(message, myNickname, currentConversation);
	}
	$('#userInputText').val('');
	return false;
});

// Nick completion
$('#userInputText').keydown(function(e) {
	if (e.keyCode === 9) {
		e.preventDefault();
		for (var nickname in otrKeys) {
			if (match = nickname.match($(this).val().match(/(\S)+$/)[0])) {
				if ($(this).val().match(/\s/)) {
					$(this).val($(this).val().replace(match, nickname + ' '));
				}
				else {
					$(this).val($(this).val().replace(match, nickname + ': '));
				}
			}
		}
	}
});

// Detect user input submit on enter keypress
$('#userInputText').keyup(function(e) {
	if (e.keyCode === 13) {
		$('#userInput').submit();
	}
});

// Custom server dialog
$('#customServer').click(function() {
	bosh = Strophe.xmlescape(bosh);
	conferenceServer = Strophe.xmlescape(conferenceServer);
	domain = Strophe.xmlescape(domain);
	var customServerDialog = '<input type="button" class="bar" value="'
		+ Cryptocat.language['loginWindow']['customServer'] + '"/><br />'
		+ '<input type="text" class="customServer" id="customDomain"></input>'
		+ '<input type="text" class="customServer" id="customConferenceServer"></input>'
		+ '<input type="text" class="customServer" id="customBOSH"></input>'
		+ '<input type="button" class="button" id="customServerReset"></input>'
		+ '<input type="button" class="button" id="customServerSubmit"></input>';
	dialogBox(customServerDialog, 1);
	$('#customDomain').val(domain)
		.attr('title', 'Domain name')
		.click(function() {$(this).select()});
	$('#customConferenceServer').val(conferenceServer)
		.attr('title', 'XMPP-MUC server')
		.click(function() {$(this).select()});
	$('#customBOSH').val(bosh)
		.attr('title', 'BOSH relay')
		.click(function() {$(this).select()});
	$('#customServerReset').val(Cryptocat.language['loginWindow']['reset']).click(function() {
		$('#customDomain').val(defaultDomain);
		$('#customConferenceServer').val(defaultConferenceServer);
		$('#customBOSH').val(defaultBOSH);
		if (localStorageOn) {
			localStorage.removeItem('domain');
			localStorage.removeItem('conferenceServer');
			localStorage.removeItem('bosh');
		}
	});
	$('#customServerSubmit').val(Cryptocat.language['chatWindow']['continue']).click(function() {
		domain = $('#customDomain').val();
		conferenceServer = $('#customConferenceServer').val();
		bosh = $('#customBOSH').val();
		$('#dialogBoxClose').click();
		if (localStorageOn) {
			localStorage.setItem('domain', domain);
			localStorage.setItem('conferenceServer', conferenceServer);
			localStorage.setItem('bosh', bosh);
		}
	});
	$('#customDomain').select();
	$('.customServer').qtip({
		position: {
			my: 'center left',
			at: 'center right'
		}
	});
});

// Language selector
$('#languages').change(function() {
	language = Language.set($(this).val());
	if (localStorageOn) {
		localStorage.setItem('language', $(this).val());
	}
	$('#conversationName').select();
});

// Login form
$('#conversationName').click(function() {
	$(this).select();
});
$('#nickname').click(function() {
	$(this).select();
});
$('#loginForm').submit(function() {
	// Don't submit if form is already being processed
	if (($('#loginSubmit').attr('readonly') === 'readonly')) {
		return false;
	}
	//Check validity of conversation name and nickname
	$('#conversationName').val($.trim($('#conversationName').val().toLowerCase()));
	$('#nickname').val($.trim($('#nickname').val().toLowerCase()));
	if (($('#conversationName').val() === '')
		|| ($('#conversationName').val() === Cryptocat.language['loginWindow']['conversationName'])) {
		loginFail(Cryptocat.language['loginMessage']['enterConversation']);
		$('#conversationName').select();
	}
	else if (!$('#conversationName').val().match(/^\w{1,20}$/)) {
		loginFail(Cryptocat.language['loginMessage']['conversationAlphanumeric']);
		$('#conversationName').select();
	}
	else if (($('#nickname').val() === '')
		|| ($('#nickname').val() === Cryptocat.language['loginWindow']['nickname'])) {
		loginFail(Cryptocat.language['loginMessage']['enterNickname']);
		$('#nickname').select();
	}
	else if (!$('#nickname').val().match(/^\w{1,16}$/)) {
		loginFail(Cryptocat.language['loginMessage']['nicknameAlphanumeric']);
		$('#nickname').select();
	}
	// If no encryption keys, generate
	else if (!myKey) {
		var progressForm = '<br /><p id="progressForm"><img src="img/keygen.gif" '
			+ 'alt="" /><p id="progressInfo"><span>'
			+ Cryptocat.language['loginMessage']['generatingKeys'] + '</span></p>';
		dialogBox(progressForm, 0, function() {
			// We need to pass the web worker some pre-generated random values
			var randomReserve = [];
			for (var i = 0; i < 4096; i++) { // Yes, we actually need that many
				randomReserve.push(Cryptocat.random());
			}
			keyGenerator.postMessage(randomReserve.join(','));
			if (localStorageOn) {
				localStorage.setItem('multiPartyKey', multiParty.genPrivateKey());
			}
			else {
				multiParty.genPrivateKey();
			}
			multiParty.genPublicKey();
		}, function() {
			$('#loginSubmit').removeAttr('readonly')
			$('#loginForm').submit();
			$('#loginSubmit').attr('readonly', 'readonly');
		});
		if (Cryptocat.language['language'] === 'en') {
			$('#progressInfo').append(
				'<br />Here is an interesting fact while you wait:'
				+ '<br /><br /><span id="interestingFact">'
				+ CatFacts.getFact() + '</span>'
			);
		}
		$('#progressInfo').append(
			'<div id="progressBar"><div id="fill"></div></div>'
		);
		var catFactInterval = window.setInterval(function() {
			$('#interestingFact').fadeOut(function() {
				$(this).text(CatFacts.getFact()).fadeIn();
			});
			if (myKey) {
				clearInterval(catFactInterval);
			}
		}, 10000);
		$('#fill').animate({'width': '100%', 'opacity': '1'}, 26000, 'linear');
	}
	// If everything is okay, then register a randomly generated throwaway XMPP ID and log in.
	else {
		conversationName = Strophe.xmlescape($('#conversationName').val());
		myNickname = Strophe.xmlescape($('#nickname').val());
		loginCredentials[0] = Cryptocat.randomString(256, 1, 1, 1, 0);
		loginCredentials[1] = Cryptocat.randomString(256, 1, 1, 1, 0);
		registerXMPPUser(loginCredentials[0], loginCredentials[1]);
		$('#loginSubmit').attr('readonly', 'readonly');
	}
	return false;
});

// Registers a new user on the XMPP server.
function registerXMPPUser(username, password) {
	var registrationConnection = new Strophe.Connection(bosh);
	registrationConnection.register.connect(domain, function(status) {
		if (status === Strophe.Status.REGISTER) {
			$('#loginInfo').text(Cryptocat.language['loginMessage']['registering']);
			registrationConnection.register.fields.username = username;
			registrationConnection.register.fields.password = password;
			registrationConnection.register.submit();
		}
		else if (status === Strophe.Status.REGISTERED) {
			registrationConnection.disconnect();
			delete registrationConnection;
			login(loginCredentials[0], loginCredentials[1]);
			return true;
		}
		else if (status === Strophe.Status.SBMTFAIL) {
			return false;
		}
	});
}

// Logs into the XMPP server, creating main connection/disconnection handlers.
function login(username, password) {
	conn = new Strophe.Connection(bosh);
	conn.connect(username + '@' + domain, password, function(status) {
		if (status === Strophe.Status.CONNECTING) {
			$('#loginInfo').animate({'color': '#999'}, 'fast');
			$('#loginInfo').text(Cryptocat.language['loginMessage']['connecting']);
		}
		else if (status === Strophe.Status.CONNFAIL) {
			if (!loginError) {
				$('#loginInfo').text(Cryptocat.language['loginMessage']['connectionFailed']);
			}
			$('#loginInfo').animate({'color': '#E93028'}, 'fast');
		}
		else if (status === Strophe.Status.CONNECTED) {
			conn.muc.join(
				conversationName + '@' + conferenceServer, myNickname, 
				function(message) {
					if (handleMessage(message)) {
						return true;
					}
				},
				function (presence) {
					if (handlePresence(presence)) {
						return true;
					}
				}
			);
			if (localStorageOn) {
				localStorage.setItem('myNickname', myNickname);
			}
			$('#buddy-main-Conversation').attr('status', 'online');
			$('#loginInfo').text('✓');
			$('#loginInfo').animate({'color': '#0F0'}, 'fast');
			$('#bubble').animate({'margin-top': '+=0.5%'}, function() {
				$('#bubble').animate({'margin-top': '1%'}, function() {
					$('#loginLinks').fadeOut();
					$('#info').fadeOut();
					$('#version').fadeOut();
					$('#options').fadeOut();
					$('#loginForm').fadeOut();
					$('#bubble').animate({'width': '900px'});
					$('#bubble').animate({'height': '550px'}, function() {
						$('.button').fadeIn();
						$('#buddyWrapper').fadeIn('fast', function() {
							var scrollWidth = document.getElementById('buddyList').scrollWidth;
							$('#buddyList').css('width', (150 + scrollWidth) + 'px');
							if (groupChat) {
								bindBuddyClick('main-Conversation');
								window.setTimeout(function() {
									$('#buddy-main-Conversation').click();
									buddyNotifications = 1;
								}, 500);
							}
						});
					});
				});
			});
			loginError = 0;
		}
		else if (status === Strophe.Status.DISCONNECTED) {
			$('.button').fadeOut('fast');
			$('#conversationInfo').animate({'width': '0'});
			$('#conversationInfo').text('');
			$('#userInput').fadeOut(function() {
				$('#conversationWindow').slideUp(function() {
					$('#buddyWrapper').fadeOut();
					if (!loginError) {
						$('#loginInfo').animate({'color': '#999'}, 'fast');
						$('#loginInfo').text(Cryptocat.language['loginMessage']['thankYouUsing']);
					}
					$('#bubble').animate({'width': '680px'});
					$('#bubble').animate({'height': '310px'})
						.animate({'margin-top': '5%'}, function() {
							$('#buddyList div').each(function() {
								if ($(this).attr('id') !== 'buddy-main-Conversation') {
									$(this).remove();
								}
							});
							$('#conversationWindow').text('');
							otrKeys = {};
							multiParty.reset();
							conversations = {};
							loginCredentials = [];
							currentConversation = 0;
							conn = null;
							if (!loginError) {
								$('#conversationName').val(Cryptocat.language['loginWindow']['conversationName']);
							}
							$('#nickname').val(Cryptocat.language['loginWindow']['nickname']);
							$('#info').fadeIn();
							$('#loginLinks').fadeIn();
							$('#version').fadeIn();
							$('#options').fadeIn();
							$('#loginForm').fadeIn('fast', function() {
								$('#conversationName').select();
								$('#loginSubmit').removeAttr('readonly');
							});
						});
					$('.buddy').unbind('click');
					$('.buddyMenu').unbind('click');
					$('#buddy-main-Conversation').insertAfter('#buddiesOnline');
				});
			});
		}
		else if (status === Strophe.Status.AUTHFAIL) {
			loginFail(Cryptocat.language['loginMessage']['authenticationFailure']);
			$('#conversationName').select();
			$('#loginSubmit').removeAttr('readonly');
		}
	});
}

// Logout function
function logout() {
	buddyNotifications = 0;
	conn.muc.leave(conversationName + '@' + conferenceServer);
	conn.disconnect();
}

// Logout on browser close
$(window).unload(function() {
	logout();
});

});//:3

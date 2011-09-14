// Set up your CF.userMain with a function that executes once the environment is ready
CF.userMain = function() {
};

var gui = {
	instances: [],
	server: undefined,
	joinStart: "10"
};

function startBrowsingForITunes() {
	iTunes.startNetworkLookup(networkLookupCallback);
}



function stopBrowsingForITunes() {
	iTunes.stopNetworkLookup();
}

function networkLookupCallback(added, removed) {
	// keeps the list of running iTunes instances up to date
	for (var i=0; i < added.length; i++) {
		gui.instances.push(added[i]);
		CF.listAdd("l1", [
			{	// add one item
				s1: added[i].displayName,
				d2: {
					tokens: {"[name]": added[i].name}
				}
			}
		]);
	}
	for (var i=0; i < removed.length; i++) {
		var instance = removed[i];
		if (gui.server !== undefined && instance.name == gui.server.service.name) {
			deselectInstance();
		}
		for (var j=0; j < instances.count; j++) {
			if (gui.instances[j].name == instance.name) {
				CF.listRemove("l1", j);
				gui.instances.splice(j);
				break;
			}
		}
	}
	CF.listContents("l1", 0, 1, function(items) {
		CF.logObject(items);
	});
}

function selectInstance(name) {
	// an iTunes instance was selected
	for (var i=0; i < gui.instances.length; i++) {
		if (gui.instances[i].name == name) {
			if (gui.server === undefined || gui.server.service.name != name) {
				// change server
				gui.server = new iTunesInstance(gui.instances[i]);
				gui.server.connect();
			}
			return;
		}
	}
}

function selectDatabase(id) {
	
	if(id == null){
		gui.server.selectDatabase("", "0");
		return null;
	}
	
	var idSplit = id.split(":");
	if(idSplit.length == 2){
		if (idSplit[1] == "[cmd]") {
			gui.server.selectDatabase(idSplit[0], "0");
		}else {
			gui.server.selectDatabase(idSplit[0], idSplit[1]);
		}
	} else if (idSplit.length == 3) {
			if(idSplit[2] != "[place]"){
				gui.server.selectDatabase(idSplit[0].substr(0,idSplit[0].length -1), idSplit[1], idSplit[2]);
			}else {
				gui.server.selectDatabase(idSplit[0], idSplit[1]);
			}
	}

}

function setVolume(volume) {

	gui.server.setVolume(volume);

}

function selectSpeakers(id) {
	// an iTunes instance was selected
	gui.server.setSpeakers(id);
}

function itunesAction(action) {
	//does action
	gui.server.action(action);
}

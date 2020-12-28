window.Anvedi = (function () {

	/*
	Some utils here
	 */

	/**
	 * merge and join two array index by index ([a1,b1,c1], [a2,b2,c2] => [a1,a2,b1,b2,c1,c2].join("")
	 * the second could be shorther than the first one
	 * @param arr1
	 * @param arr2
	 * @returns {*}
	 */
	const mergeAndJoinChunks = (arr1, arr2) => arr1.map((v, index) => v + (arr2[index] || "")).join("");

	/**
	 * given a complex key string (i.e. "user.name") and a referer object, search the inner key inside the referer object
	 * @param obj
	 * @param complexKey
	 * @returns {*}
	 */
	const extractValueFromObject = (obj, complexKey) => {
		let currentObj = obj;
		complexKey.split(".").forEach(k => {
			currentObj = currentObj[k];
		});
		return currentObj;
	}

	/**
	 * given a text, a global mapKeyValue and a regexp, split the text in chunks removing the vars and store its reference.
	 * returns the chunks of the string, the variable founds and the its current values according to vars object.
	 *
	 * for example:
	 * chunkizeString("Hello {{a}} and {{b}} nice to meet you", {a:"John", b:"Clark"}, /{{(.*?)}}/g)
	 * returns
	 * {chunks:["Hello ", " and ", " nice to meet you"], keys:["a","b"], values:["John","Clark"]}
	 *
	 * @param text String
	 * @param vars Object
	 * @param regexp RegExp
	 * @returns {{chunks: [], keys: *[], values: []}}
	 */
	const chunkizeString = (text, vars, regexp)=> {
		const chunks  = [];
		const matches = text.matchAll(regexp);
		let currentIndex = 0;
		const values     = [];
		const keys       = [...matches].map(match => {
			let [matchIndex, varName, varString] = [match.index, match[1], match[0]];
			chunks.push(text.substring(currentIndex, matchIndex));
			currentIndex = matchIndex + varString.length;
			values.push(extractValueFromObject(vars, varName));
			return varName;
		});
		chunks.push(text.substring(currentIndex));
		return {chunks, keys, values};
	}

	const normalizeEscapedVarOnNode = node=> {
		let chunks = node.nodeValue.split('{\\{');
		if(chunks.length > 1) {
			node.nodeValue = chunks.join('{{');
		}
	}

	/**
	 * if inside the node text there are variables (catched with {{}}) the split the textnode and keep track the
	 * variables. We don't need to search string anymore: we're linking the textnode with the rispective variable.
	 * @param node
	 * @param vars
	 * @param handlerSets
	 */
	function varBindingTextNode(node, vars, handlerSets) {
		const regexP     = /{{(.*?)}}/g;
		const matches    = node.nodeValue.matchAll(regexP);
		/*
			for each match, keep track of position and split efficiently the textNode in three or more parts.
			i.e given the TextNode "Hello {{name}} how are you?", we're going to split it in 3 nodes:
			1) "Hello " (node 1)
			2) "" (node2)
			3) "how are you?" (node3)
			the second is the only dynamic and its value depend on linked variable value.
			the third could be split in other nodes if there are other variables
        */
		let currentIndex = 0;
		let currentNode  = node;
		[...matches].forEach((match,index,v) => {
			// split here in three parts. The currentNode become node1
			let node2              = currentNode.splitText(match.index - currentIndex);
			let node3               = node2.splitText(match[0].length);
			let keySearched          = match[1];

			normalizeEscapedVarOnNode(currentNode);

			// set the current value. keySearched could be complex (ie. user.address.cap)
			node2.nodeValue = extractValueFromObject(vars, keySearched);

			// register the listener for variable changes. In case of missing listener, create it
			// (maybe it will be useful for dynamic texts)
			handlerSets[keySearched] = handlerSets[keySearched] || [];

			handlerSets[keySearched].push(function (obj, key, value) {
				// simply modify the node2 with the current var value
				node2.nodeValue = value;
			});

			// prepare and fix the origin point for the next match, according to the new node1
			currentIndex += match[0].length + match.index;
			currentNode = node3;
			if(index === v.length -1) {
				normalizeEscapedVarOnNode(currentNode);
			}
		});
	}



	/**
	 * here is a little more complex respect to the node.
	 * Here we have a string that cannot be split in nodes.
	 * At every change we have to rebuild the string.
	 * So here we have to simulate which we have done for textnodes, dividing the string in chunks
	 * and keep track of all values
	 * @param attr
	 * @param vars
	 * @param handlerSets
	 */
	function varBindingAttribute(attr, vars, handlerSets) {

		const {chunks, keys, values} = chunkizeString(attr.value, vars,  /{{(.*?)}}/g);
		// set current value
		attr.value = mergeAndJoinChunks(chunks, values);
		const updateAttribute = (keyIndex, key, value) => {
			// we have to update the current value
			values[keyIndex] = value;
			attr.value = mergeAndJoinChunks(chunks, values);
		};

		// set listeners for further modifications
		keys.forEach((key, index) => {
			handlerSets[key] = handlerSets[key] || [];
			handlerSets[key].push(function (obj, tKey, value) {
				updateAttribute(index, tKey, value);
			});
		});



	}

	/**
	 * recursive function for exploring DOM searching variables
	 * The more little is the component, the more efficient is the exploring
	 * @param element
	 * @param vars
	 * @param handlerSets
	 * @private
	 */
	function _varBindingElement(element, vars, handlerSets) {
		if (element.nodeType !== Node.TEXT_NODE) {
			for (let i = 0; i < element.attributes.length; i++) {
				let attr = element.attributes.item(i);
				// check if there is at least one var, avoiding to do an useless less efficient regexp
				if (attr.value.split("{{").length > 1)
					varBindingAttribute(attr, vars, handlerSets);
			}
			[...element.childNodes].forEach(node => {
				_varBindingElement(node, vars, handlerSets)
			});
			return;
		}
		varBindingTextNode(element, vars, handlerSets);
	}

	/**
	 * Anvedi constructor.
	 * here we go. Given the main HTMLElement element and an object of all defaults values, it happens the magic!
	 *
	 * @param element HTMLElement
	 * @param defaults Object
	 * @return Object Proxied data
	 * @constructor
	 */
	function Anvedi(element, defaults) {

		// a list of all listeners to all dynamic values in defaults
		const handlerSets = {};
		// we need to keep track of nested objects
		const proxiesMap  = new Map();

		// the proxy for change listeners
		let proxy = {
			get(target, key) {
				let refObj = target[key];
				// for nested object, we have to return a proxy for each child
				if (typeof refObj === 'object' && refObj !== null) {
					// if it's the first time that we access this object, we have to create the proxy for it and storing it inside
					// the proxiesMap. Keep track of the parent object for further pars
					if (!proxiesMap.has(refObj)) {
						proxiesMap.set(refObj, {
							proxy   : new Proxy(refObj, proxy),
							parents : []
						});
						proxiesMap.get(refObj).parents.push(key);
					}
					return proxiesMap.get(refObj).proxy;
				}

				return refObj;

			},
			set(obj, key, value) {
				// maybe we are inside a child proxy, or maybe not
				// in case of nested object we have only the last key and the last object.
				// (i.e. if we're modifiying the user.personalData.email the key here is just "email")
				// But inside the proxiesMap we have all the parent chain (user,personalData)
				let realKeyChunks = (proxiesMap.has(obj) ? proxiesMap.get(obj).parents : []);
				let realKey       = [...realKeyChunks, key].join(".");

				// Notify all the listeners for this key that the value is changed
				handlerSets[realKey] && handlerSets[realKey].forEach(callback => {
					callback(obj, key, value);
				});

				// accept the modification inside the proxy
				return true;
			}
		}
		// proxying the defualts data
		let proxiedData = new Proxy(defaults, proxy);

		// search references of variables inside the elements and fill the collection of listeners
		_varBindingElement(element, defaults, handlerSets);

		this.proxiedData = proxiedData;

		// return the proxy. Any modification inside this object will notify the application
		// return proxiedData;
	}
	Anvedi.prototype.getProxy = function() {
		return this.proxiedData;
	}
	return Anvedi;
})();
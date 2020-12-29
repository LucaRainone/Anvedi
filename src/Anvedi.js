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
	const mergeAndJoinChunks = (arr1, arr2) => arr1.map((v, index) => v + (arr2[index] === undefined? "" : arr2[index])).join("");

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
		if([...matches].length === 0)
			normalizeEscapedVarOnNode(node);
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

	function varBindingAttributeName(element, varName, vars, handlerSets) {
		let attrKeyValue = vars[varName];
		if(!(typeof(attrKeyValue) === 'object')) {
			console.error("Dynamic attributes must be objects");
			return ;
		}
		element.removeAttribute("{{"+varName+"}}");

		let currentObjects = {};
		for(let i in attrKeyValue) {
			currentObjects[i] =attrKeyValue;
			element.setAttribute(i, attrKeyValue[i]);
			let fullKey = varName + "." +i;
			handlerSets[fullKey] = handlerSets[fullKey] || [];
			handlerSets[fullKey].push((obj, tKey, value)=> {
				element.setAttribute(tKey, value);
			});
		}
		handlerSets[varName] = handlerSets[varName] || [];
		handlerSets[varName].push((obj, tKey, value)=> {
			element.setAttribute(tKey, value);
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
		if(element.nodeName.toLowerCase() === "template" && element.getAttribute('data-foreach')) {
			let varName = element.getAttribute('data-foreach');
			varName = varName.substring(2,varName.length-2);
			handlerSets[varName] = handlerSets[varName] || [];
			engineLists(element,extractValueFromObject(vars, varName), handlerSets[varName]);
			return ;
		}
		if (element.nodeType !== Node.TEXT_NODE) {
			if(element.attributes) {
				for (let i = 0; i < element.attributes.length; i++) {
					let attr = element.attributes.item(i);
					if (attr.name.match(/^{{.*?}}$/)) {
						varBindingAttributeName(element, attr.name.substr(2, attr.name.length - 4), vars, handlerSets);
						continue;
					}
					// check if there is at least one var, avoiding to do an useless less efficient regexp
					if (attr.value.split("{{").length > 1) {
						varBindingAttribute(attr, vars, handlerSets);
					}
				}
			}
			let childNodes = [...element.childNodes].slice(0);
			childNodes.forEach(node => {
				// console.log({node,l:childNodes.length});
				_varBindingElement(node, vars, handlerSets);
			});
			return;
		}
		varBindingTextNode(element, vars, handlerSets);
	}

	const moveNodeAt = (node,index) => {
		console.log({node})
		if(+index >= node.parentNode.children.length) {
			node.parentNode.appendChild(node)
		}else {
			node.parentNode.insertBefore(node, node.parentNode.children[+index]);
		}
	}

	function engineLists(template, proxiedArray, handlerSet) {
		let varName = template.getAttribute('data-foreach-to');
		let nodeIndexed = [];
		const addItem = (item, index)=> {
			let tree = template.content.cloneNode(true);
			let data = {
				'%index': index
			};
			data[varName] = item;
			template.parentNode.insertBefore(tree, template);
			// the fragment is totally replaced (and emptied) by its content. So for fetch the real node
			// we have to search it in DOM. Warning a fragmetn could be composed by 2 or more siblings (TODO)
			let newNode = template.previousElementSibling;
			nodeIndexed[index] = newNode;
			let anvediInstance = new Anvedi(newNode, data, varName);
			newNode.__anvedi = {instance:anvediInstance,index};
		}

		const removeItem = (index) => {
			let node = nodeIndexed[index];
			node.parentNode.removeChild(node);
			nodeIndexed.splice(index,1);
		}

		const refreshIndex = ()=> {
			nodeIndexed.forEach((node,index)=> {
				let data = node.__anvedi.instance.getProxy();
				data['%index'] = index;
			});
		}

		proxiedArray.forEach((item, index) => {
			addItem(item, index)
		});

		handlerSet.push((obj, key, value) => {
			if(obj === proxiedArray) {
				switch(key) {
					case 'push' :
						addItem(value.args[0], proxiedArray.length);
						break;
					case 'unshift' :
						addItem(value.args[0], proxiedArray.length);
						let node = nodeIndexed.splice(nodeIndexed.length-1,1);
						node = node[0];
						nodeIndexed.unshift(node);
						moveNodeAt(node, 0)
						refreshIndex();
						break;
					case 'pop' :
						removeItem(proxiedArray.length-1);
						break;
					case 'shift' :
						removeItem(0);
						refreshIndex();
						break;
					case 'splice' :
						let [start, dels, ...items] = value.args;
						if(dels > 0) {
							for(let i = 0; i < dels; i++) {
								removeItem(start)
							}
						}
						for(let i = 0; i < items.length; i++) {
							addItem(items[i], proxiedArray.length);
							let node = nodeIndexed.pop();
							nodeIndexed.splice(start,0,node);
							moveNodeAt(node, start+i);
						}
						refreshIndex();
						break;
					case 'sort' :
					case 'reverse' :
					case 'filter' :
					case 'concat' :
					case 'slice' :
						// TODO (rebuild all?)
						break;
				}
			}

		});

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

		const getParentsOfObj = obj=> {
			if(proxiesMap.has(obj)) {
				return proxiesMap.get(obj).parents.slice(0);
			}
			return [];
		}

		const notifyParents = (obj, value, realKeyChunks, key)=> {
			// notify all the parents too if there is some listeners
			let currentParents = [...realKeyChunks, key];
			while(currentParents.length > 1) {
				currentParents = currentParents.slice(0,currentParents.length -1);
				let realKey = currentParents.join(".");

				handlerSets[realKey] && handlerSets[realKey].forEach(callback => {
					callback(obj, key, value, realKey);
				});
			}
		}

		// the proxy for change listeners
		let proxy = {
			get(target, key) {

				if(key === '__anvedi_hack_retrieve_org_target') {
					return target;
				}

				let refObj = target[key];

				if(Array.isArray(target)) {
					let proxyArray = proxiesMap.get(target);

					switch(key) {
						case 'push' :
						case 'pop' :
						case 'splice' :
						case 'shift' :
						case 'unshift' :
						case 'sort' :
						case 'reverse' :
						case 'filter' :
						case 'concat' :
							return function() {
								let args = [...arguments];
								let realKeyChunks = (proxyArray.parents);
								let realKey       = [...realKeyChunks, key].join(".");
								// Notify all the listeners for this key that the value is changed
								handlerSets[realKey] && handlerSets[realKey].forEach(callback => {
									callback(target, key, {args});
								});
								notifyParents(target, {args}, realKeyChunks, key);
								target[key].call(target, ...args)
							}
					}
				}

				// if the object is already proxied, don't proxy again the object (proxy of proxy)
				// if(refObj && refObj.__anvedi_hack_retrieve_org_target) {
					// return refObj;
				// }

				// for nested object, we have to return a proxy for each child
				if (typeof refObj === 'object' && refObj !== null) {
					// if it's the first time that we access this object, we have to create the proxy for it and storing it inside
					// the proxiesMap. Keep track of the parent object for further pars
					if (!proxiesMap.has(refObj)) {
						proxiesMap.set(refObj, {
							proxy   : new Proxy(refObj, proxy),
							parents : getParentsOfObj(target),
							isArray: Array.isArray(refObj)
						});
						let proxyInfo = proxiesMap.get(refObj);
						proxyInfo.parents.push(key);
					}
					return proxiesMap.get(refObj).proxy;
				}

				return refObj;

			},
			set(obj, key, value) {

				if(!Array.isArray(obj) && !obj.hasOwnProperty(key)) {
					obj[key] = value;
					return true;
				}

				if(Array.isArray(obj) && key === "length") {
					obj[key] = value;
					return true;
				}

				// maybe we are inside a child proxy, or maybe not
				// in case of nested object we have only the last key and the last object.
				// (i.e. if we're modifiying the user.personalData.email the key here is just "email")
				// But inside the proxiesMap we have all the parent chain (user,personalData)
				let realKeyChunks = (proxiesMap.has(obj) ? proxiesMap.get(obj).parents : []);
				let realKey       = [...realKeyChunks, key].join(".");
				obj[key] = value;

				// Notify all the listeners for this key that the value is changed
				handlerSets[realKey] && handlerSets[realKey].forEach(callback => {
					callback(obj, key, value);
				});
				notifyParents(obj, value, realKeyChunks, key);

				// accept the modification inside the proxy
				return true;
			},
			deleteProperty(obj, key) {
				// console.log({obj,key, type:"delete"})
				delete obj[key];
				if(proxiesMap.has(obj)) {
					let proxyInfo = proxiesMap.get(obj);
					notifyParents(obj, undefined, proxyInfo.parents, key)
				}
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
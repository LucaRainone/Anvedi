# Anvedi

This is an experiment to try to reproduce and understand the basics of the most populars library/frameworks like Vue or
React in pure JavaScript. Please don't use it in production but feel free to read, understand and improve it.

How it works. Here some example:

## basic sample

```
<!--demo/sample.html-->
<div id="app">
    <h3 {{attributes}}>Now is {{now}}</h3>
</div>
<script>
    const app = new Anvedi(document.getElementById("app"), {
        data: {
            now: new Date(),
            attributes: {
                style: "color:red"
            }
        }
    });
    const data = app.getProxy();

    setInterval(()=>{ data.now = new Date();}, 1000)

</script>
```

## Listener sample

```
<!--demo/listeners.html-->
<div id="app">
    <h3 anvedi-onclick="clickHandler">Click me</h3>

    <span>The text will be replace with "{{textClicked}}"</span>
</div>
<script>
    const app = new Anvedi(document.getElementById("app"), {
        data: {
            textClicked: "Clicked! \\o/"
        },
        listeners: {
            clickHandler(element) {
                element.innerHTML = this.textClicked;
            }
        }
    });
    const data = app.getProxy();

    setInterval(()=>{ data.now = new Date();}, 1000)

</script>
```

## List sample

```
<div id="app">
    <label>
        Insert your name
        <input type="text" placeholder="John Doe" value="" id="inputName">
    </label>
    <br><br>
    TODO list of {{name}}
    <ul>
        <template anvedi-foreach="{{todos}}" anvedi-foreach-to="todo">
            <li>asd {{todo.text}} (to do by {{name}}) </li>
        </template>
    </ul>

    <button type="button" id="execPush" anvedi-onclick="addATodo">exec a data.todos.push({text: "Another todo"})</button>
</div>
<script>
    const inputName = document.getElementById("inputName");
    const app = new Anvedi(document.getElementById("app"), {
        data: {
            now: new Date(),
            name: "unknown",
            todos: [
                {text: "Todo 1"},
                {text: "Todo 2"},
                {text: "Todo 3"},
            ]
        },
        listeners: {
            addATodo() {
                data.todos.push({text:"Another todo"})
            }
        }
    });
    const data = app.getProxy();

    inputName.addEventListener('keyup', function() {
        data.name = this.value;
    });


</script>
```

See it in live [https://lucarainone.github.io/Anvedi/demo/index.html](https://lucarainone.github.io/Anvedi/demo/index.html)
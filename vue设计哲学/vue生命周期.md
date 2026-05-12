vue的生命周期
- vue的每个生命周期都做了什么？
- beforeCreate: 初始化vue实例，$data, $options, $listners, 这时不能访问methods, data
- created: 初始化data, methods等，这时可以访问
- beforeMount: 初始化render函数，转换成虚拟dom,这时dom未挂载
- mounted: 将虚拟dom转换成真实dom，这时可以访问dom。初始化页面时可以在这个时机操作dom
- beforeUpdate: 收集更新的数据，与虚拟dom做比较，转换新的虚拟dom
- updated: 将新的，对比后的dom转换成真实dom
- beforeDestory: 销毁dom，data, methods
- destored: 销毁vue实例
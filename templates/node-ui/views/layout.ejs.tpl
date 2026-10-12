<!doctype html>
<html lang="en" data-app="{{SLUG}}" <%- theme.htmlAttrs %><% if (theme.accentStyle) { %> style="<%= theme.accentStyle %>"<% } %>>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title><%= title ? title + ' · ' : '' %>{{NAME}}</title>
  <%- themeBoot %>
  <link rel="stylesheet" href="<%= kit('/tokens/tokens.css') %>">
  <link rel="stylesheet" href="<%= kit('/tokens/accents.css') %>">
  <link rel="stylesheet" href="<%= kit('/ui/base.css') %>">
  <link rel="stylesheet" href="<%= kit('/ui/components.css') %>">
  <link rel="stylesheet" href="/public<%= asset('/app.css') %>">
</head>
<body>
  <%- body %>
</body>
</html>

using Etqan.Api.Services;
using Microsoft.Data.SqlClient;
using Microsoft.AspNetCore.Diagnostics;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options => options.AddPolicy("React", policy =>
    policy.WithOrigins("http://127.0.0.1:5173", "http://localhost:5173")
        .AllowAnyHeader()
        .AllowAnyMethod()));
builder.Services.AddControllers();
builder.Services.AddSingleton<SqlGameStore>();

var app = builder.Build();
app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    context.Response.StatusCode = exception is SqlException or HttpRequestException or InvalidOperationException
        ? StatusCodes.Status503ServiceUnavailable
        : StatusCodes.Status500InternalServerError;
    context.Response.ContentType = "application/json";
    await context.Response.WriteAsJsonAsync(new
    {
        message = exception is SqlException or InvalidOperationException
            ? "SQL Server is unavailable. Please check that the database is running and reload the game."
            : "The game service could not complete the request. Please reload the game."
    });
}));
app.UseCors("React");
app.MapGet("/api/health", () => Results.Ok(new { service = "Etqan.Api", status = "ok" }));
app.MapControllers();
app.Run();
